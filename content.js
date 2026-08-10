(function () {
  const STORAGE_KEY = "ghaLogCopierEnabled";
  const TIMESTAMP_KEY = "ghaLogCopierTimestamps";
  let enabled = true;
  let includeTimestamps = false;

  const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;

  function stripAnsi(text) {
    return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
  }

  function stripTimestamps(text) {
    return text
      .split("\n")
      .map((line) => line.replace(TIMESTAMP_PREFIX, ""))
      .join("\n");
  }

  // Fallback: only grabs whatever rows GitHub currently has virtualized/rendered in the DOM.
  function extractVisibleLogText(detailsEl) {
    const lineEls = detailsEl.querySelectorAll(".js-check-step-line");
    return Array.from(lineEls)
      .map((lineEl) => {
        const contentEl = lineEl.querySelector(".js-check-line-content");
        if (!contentEl) return null;
        const text = contentEl.innerText.replace(/\n+$/, "");
        if (includeTimestamps) {
          const tsEl = lineEl.querySelector(".CheckStep-line-timestamp");
          const ts = tsEl ? tsEl.innerText.trim() : "";
          return ts ? `${ts}  ${text}` : text;
        }
        return text;
      })
      .filter((t) => t !== null)
      .join("\n");
  }

  // Preferred: fetch the full raw log from GitHub's per-step log endpoint, which
  // is not subject to the DOM virtualization that truncates long steps on screen.
  async function extractFullLogText(detailsEl) {
    const logUrl = detailsEl.getAttribute("data-log-url");
    if (!logUrl) return extractVisibleLogText(detailsEl);
    try {
      const res = await fetch(logUrl, {
        credentials: "same-origin",
        headers: { Accept: "text/plain" },
      });
      if (!res.ok) throw new Error("bad status " + res.status);
      let raw = await res.text();
      if (!raw.trim()) throw new Error("empty log body");
      raw = stripAnsi(raw);
      if (!includeTimestamps) raw = stripTimestamps(raw);
      return raw;
    } catch (err) {
      // Network hiccup, expired logs, etc. — fall back to whatever is on screen.
      return extractVisibleLogText(detailsEl);
    }
  }

  function flash(btn, label, ok) {
    btn.textContent = label;
    btn.classList.toggle("gha-copy-btn--done", ok);
    btn.classList.toggle("gha-copy-btn--fail", !ok);
    setTimeout(() => {
      btn.textContent = "Copy log";
      btn.classList.remove("gha-copy-btn--done", "gha-copy-btn--fail");
    }, 1400);
  }

  function makeButton(detailsEl) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gha-copy-btn";
    btn.textContent = "Copy log";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = "Fetching...";
      const text = await extractFullLogText(detailsEl);
      const copied = await copyToClipboard(text);
      flash(btn, copied ? "Copied" : "Failed", copied);
      btn.disabled = false;
    });
    return btn;
  }

  function injectButton(detailsEl) {
    if (!enabled) return;
    const summary = detailsEl.querySelector("summary");
    if (!summary) return;
    const row = summary.querySelector(".d-flex.flex-items-center") || summary;
    if (row.querySelector(".gha-copy-btn")) return;
    row.appendChild(makeButton(detailsEl));
  }

  function removeAllButtons() {
    document
      .querySelectorAll(".gha-copy-btn, .gha-dependabot-copy-btn")
      .forEach((b) => b.remove());
  }

  function handleDetails(detailsEl) {
    if (detailsEl.open) injectButton(detailsEl);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.attributeName === "open" && detailsEl.open) {
          injectButton(detailsEl);
        }
      });
    });
    observer.observe(detailsEl, { attributes: true });
  }

  function scan() {
    if (!enabled) return;
    document
      .querySelectorAll("details.js-checks-log-details, details[data-step-number]")
      .forEach((detailsEl) => {
        if (detailsEl.dataset.ghaCopyBound) return;
        detailsEl.dataset.ghaCopyBound = "1";
        handleDetails(detailsEl);
      });
    injectDependabotButton();
  }

  // ---------------------------------------------------------------------
  // Dependabot alerts -> Markdown
  // ---------------------------------------------------------------------

  function isDependabotAlertsListPage() {
    // Matches .../<owner>/<repo>/security/dependabot (optionally with a
    // trailing slash or query string), but NOT an individual alert page
    // like .../security/dependabot/45.
    return /^\/[^/]+\/[^/]+\/security\/dependabot\/?$/.test(location.pathname);
  }

  function findGiveFeedbackLink(doc) {
    return Array.from(doc.querySelectorAll("a")).find(
      (a) => a.textContent.trim() === "Give feedback"
    );
  }

  // Alert rows are identified via their title link, which always points to
  // .../security/dependabot/<number>. We then climb to a reasonably small
  // ancestor to use as the "row" to search for the severity label and the
  // "#N opened ... • Detected in X (ecosystem) • manifest" meta line.
  function extractAlertRows(doc) {
    const links = Array.from(
      doc.querySelectorAll('a[href*="/security/dependabot/"]')
    ).filter((a) => /\/security\/dependabot\/\d+$/.test(a.getAttribute("href") || ""));

    const rows = [];
    const seen = new Set();
    links.forEach((link) => {
      const row =
        link.closest('div[id^="issue_"]') ||
        link.closest("li") ||
        link.closest("div.Box-row") ||
        link.parentElement;
      if (!row || seen.has(row)) return;
      seen.add(row);
      rows.push({ link, row });
    });
    return rows;
  }

  function parseAlertRow({ link, row }) {
    const title = link.textContent.replace(/\s+/g, " ").trim();

    let priority = "";
    row.querySelectorAll("span, div, a").forEach((el) => {
      if (priority) return;
      if (el.children.length > 0) return;
      const t = el.textContent.trim();
      if (/^(Critical|High|Moderate|Low)$/i.test(t)) priority = t;
    });

    let metaText = "";
    row.querySelectorAll("p, div, span").forEach((el) => {
      if (metaText) return;
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (t.includes("Detected in") && el.children.length <= 6) metaText = t;
    });

    let detectedIn = "";
    const detectMatch = metaText.match(/Detected in\s+([^(•]+)\(([^)]+)\)/);
    if (detectMatch) {
      detectedIn = `${detectMatch[1].trim()} (${detectMatch[2].trim()})`;
    }

    let file = "";
    const parts = metaText
      .split("•")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) {
      const last = parts[parts.length - 1];
      if (!/^Detected in/i.test(last) && !/^#\d/.test(last)) file = last;
    }

    const href = link.getAttribute("href") || "";
    const numberMatch = href.match(/\/security\/dependabot\/(\d+)(?:$|[?#])/);
    let absoluteHref = href;
    try {
      absoluteHref = new URL(href, location.origin).toString();
    } catch (_) {
      // Keep the original href if URL normalization fails.
    }

    return {
      number: numberMatch ? Number(numberMatch[1]) : undefined,
      title,
      priority,
      detectedIn,
      file,
      href: absoluteHref,
    };
  }

  function extractAlertsFromFetchedHtml(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return extractAlertRows(doc).map((entry) => {
      const parsed = parseAlertRow(entry);
      if (parsed.href) {
        try {
          parsed.href = new URL(parsed.href, baseUrl).toString();
        } catch (_) {
          // Keep parsed href as-is.
        }
      }
      return parsed;
    });
  }

  function normalizeDependabotListUrl(candidate, currentUrl) {
    if (!candidate) return null;
    try {
      const current = new URL(currentUrl);
      const next = new URL(candidate, current);
      if (next.origin !== current.origin) return null;
      if (next.pathname.replace(/\/$/, "") !== current.pathname.replace(/\/$/, "")) {
        return null;
      }
      return next.toString();
    } catch (_) {
      return null;
    }
  }

  function findRenderedDependabotNextUrl(doc, currentUrl) {
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      const rel = (anchor.getAttribute("rel") || "").trim();
      const ariaLabel = (anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const className = (anchor.getAttribute("class") || "").trim();
      const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
      const isNext =
        /(?:^|\s)next(?:\s|$)/i.test(rel) ||
        /\bnext(?:\s+page)?\b/i.test(ariaLabel) ||
        /(?:^|\s)next_page(?:\s|$)/i.test(className) ||
        /^next(?:\s+page)?$/i.test(text);
      if (!isNext) continue;

      const next = normalizeDependabotListUrl(anchor.getAttribute("href"), currentUrl);
      if (next) return next;
    }
    return null;
  }

  function extractNextFromFetchedHtml(html, currentUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return findRenderedDependabotNextUrl(doc, currentUrl);
  }

  function isFirstOpenDependabotView() {
    if (!isDependabotAlertsListPage()) return false;
    const url = new URL(location.href);
    if (url.searchParams.has("page") || url.searchParams.has("after") || url.searchParams.has("before")) {
      return false;
    }
    const query = (url.searchParams.get("query") || "").trim();
    return query === "" || query === "is:open";
  }

  function getRenderedDependabotInitialPage() {
    if (!isFirstOpenDependabotView()) return null;
    const nextUrl = findRenderedDependabotNextUrl(document, location.href);
    if (!nextUrl) return null;

    const alerts = extractAlertRows(document).map(parseAlertRow);
    if (alerts.length === 0) return null;
    return { alerts, nextUrl };
  }

  // Primary path: fetch every open Dependabot alert using the user's active
  // github.com session. The helper follows only pagination links/cursors GitHub
  // supplies, reads structured JSON/React payloads first, and invokes the
  // legacy row parser only if GitHub returns plain HTML.
  async function collectAllDependabotAlerts() {
    if (!globalThis.GhaDependabotFetch) {
      throw new Error("Dependabot fetch helper is not loaded");
    }

    const initialPage = getRenderedDependabotInitialPage();
    return globalThis.GhaDependabotFetch.collectAllDependabotAlerts({
      locationHref: location.href,
      fetchImpl: (url, options) => fetch(url, options),
      htmlAlertExtractor: extractAlertsFromFetchedHtml,
      htmlNextExtractor: extractNextFromFetchedHtml,
      initialPage,
    });
  }

  function buildDependabotMarkdown(alerts) {
    const lines = ["# Dependabot alerts:", ""];
    alerts.forEach((a) => {
      lines.push(`## ${a.title}`);
      lines.push("");
      lines.push(`- Priority: ${a.priority}`);
      lines.push(`- Detect in: ${a.detectedIn}`);
      lines.push(`- File: ${a.file}`);
      lines.push("");
    });
    return lines.join("\n").trimEnd() + "\n";
  }

  const DEBUG_PREFIX = "[GitGrab]";

  // navigator.clipboard.writeText() requires "recent" user activation. The
  // pagination fetches in collectAllDependabotAlerts() can burn through that
  // activation window on repos with several pages of alerts, which makes the
  // Clipboard API silently reject. execCommand('copy') via a hidden textarea
  // is far more lenient about timing, so we try the modern API first and
  // fall back to it.
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn(DEBUG_PREFIX, "navigator.clipboard.writeText failed, falling back", err);
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!ok) throw new Error("execCommand('copy') returned false");
      return true;
    } catch (err) {
      console.error(DEBUG_PREFIX, "clipboard fallback also failed", err);
      return false;
    }
  }

  function flashDependabotButton(btn, label, ok) {
    btn.textContent = label;
    btn.classList.toggle("gha-dependabot-copy-btn--done", ok);
    btn.classList.toggle("gha-dependabot-copy-btn--fail", !ok);
    setTimeout(() => {
      btn.textContent = "Copy Dependabot alerts";
      btn.classList.remove(
        "gha-dependabot-copy-btn--done",
        "gha-dependabot-copy-btn--fail"
      );
    }, 1600);
  }

  function makeDependabotButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gha-dependabot-copy-btn";
    btn.textContent = "Copy Dependabot alerts";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = "Fetching...";
      try {
        const alerts = await collectAllDependabotAlerts();
        const markdown = buildDependabotMarkdown(alerts);
        console.log(DEBUG_PREFIX, `found ${alerts.length} alert row(s)`, alerts);
        console.log(DEBUG_PREFIX, "markdown output:\n" + markdown);

        if (alerts.length === 0) {
          // Surface an empty result instead of silently copying only the header.
          console.warn(DEBUG_PREFIX, "No open Dependabot alerts were returned by GitHub.");
          flashDependabotButton(btn, "No alerts found", false);
        } else {
          const copied = await copyToClipboard(markdown);
          if (copied) {
            flashDependabotButton(btn, `Copied ${alerts.length}`, true);
          } else {
            flashDependabotButton(btn, "Copy failed", false);
          }
        }
      } catch (err) {
        console.error(DEBUG_PREFIX, "unexpected error copying Dependabot alerts", err);
        const message = String(err && err.message ? err.message : err);
        if (/GitHub returned (403|404)/.test(message)) {
          flashDependabotButton(btn, "No access", false);
        } else {
          flashDependabotButton(btn, "Failed", false);
        }
      }
      btn.disabled = false;
    });
    return btn;
  }

  function injectDependabotButton() {
    if (!enabled) return;
    if (!isDependabotAlertsListPage()) return;
    const feedbackLink = findGiveFeedbackLink(document);
    if (!feedbackLink) return;
    const container = feedbackLink.parentElement;
    if (!container || container.querySelector(".gha-dependabot-copy-btn")) return;
    container.insertBefore(makeDependabotButton(), feedbackLink);
  }

  const bodyObserver = new MutationObserver(() => scan());
  bodyObserver.observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes[STORAGE_KEY]) {
      enabled = changes[STORAGE_KEY].newValue;
      if (enabled) scan();
      else removeAllButtons();
    }
    if (changes[TIMESTAMP_KEY]) {
      includeTimestamps = changes[TIMESTAMP_KEY].newValue;
    }
  });

  chrome.storage.sync.get(
    { [STORAGE_KEY]: true, [TIMESTAMP_KEY]: false },
    (res) => {
      enabled = res[STORAGE_KEY];
      includeTimestamps = res[TIMESTAMP_KEY];
      if (enabled) scan();
    }
  );
})();
