(function (root) {
  "use strict";

  function capitalizeSeverity(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    if (text === "medium" || text === "moderate") return "Moderate";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function getValue(object, keys) {
    for (const key of keys) {
      if (object && object[key] != null) return object[key];
    }
    return undefined;
  }

  function getPackage(dependency, raw) {
    return (
      getValue(dependency, ["package", "packageInfo"]) ||
      getValue(raw, ["package", "packageInfo"]) ||
      {}
    );
  }

  function looksLikeDependabotAlert(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const number = getValue(raw, ["number", "alertNumber", "alert_number"]);
    if (number == null) return false;

    const dependency = getValue(raw, ["dependency", "vulnerableDependency"]);
    const advisory = getValue(raw, [
      "security_advisory",
      "securityAdvisory",
      "advisory",
    ]);
    const vulnerability = getValue(raw, [
      "security_vulnerability",
      "securityVulnerability",
      "vulnerability",
    ]);

    return Boolean(dependency && (advisory || vulnerability));
  }

  function normalizeAlert(raw) {
    if (!looksLikeDependabotAlert(raw)) return null;

    const dependency = getValue(raw, ["dependency", "vulnerableDependency"]) || {};
    const advisory =
      getValue(raw, ["security_advisory", "securityAdvisory", "advisory"]) || {};
    const vulnerability =
      getValue(raw, [
        "security_vulnerability",
        "securityVulnerability",
        "vulnerability",
      ]) || {};
    const pkg = getPackage(dependency, raw);

    const number = Number(getValue(raw, ["number", "alertNumber", "alert_number"]));
    const title = String(
      getValue(advisory, ["summary", "title"]) ||
        getValue(raw, ["title", "summary"]) ||
        `Dependabot alert #${number}`
    )
      .replace(/\s+/g, " ")
      .trim();

    const priority = capitalizeSeverity(
      getValue(vulnerability, ["severity"]) ||
        getValue(advisory, ["severity"]) ||
        getValue(raw, ["severity", "priority"])
    );

    const packageName = String(getValue(pkg, ["name", "packageName"]) || "").trim();
    const ecosystem = String(getValue(pkg, ["ecosystem"]) || "").trim();
    const detectedIn = packageName
      ? ecosystem
        ? `${packageName} (${ecosystem})`
        : packageName
      : "";

    const file = String(
      getValue(dependency, ["manifest_path", "manifestPath", "manifest"]) ||
        getValue(raw, ["manifest_path", "manifestPath", "manifest"]) ||
        ""
    ).trim();

    const href = String(
      getValue(raw, ["html_url", "htmlUrl", "href", "url"]) || ""
    ).trim();

    return { number, title, priority, detectedIn, file, href };
  }

  function alertKey(alert) {
    if (Number.isFinite(alert.number)) return `number:${alert.number}`;
    if (alert.href) return `href:${alert.href}`;
    return `data:${alert.title}|${alert.file}|${alert.detectedIn}`;
  }

  function extractAlertsFromJson(value) {
    const alerts = [];
    const seenObjects = new Set();
    const seenAlerts = new Set();

    function visit(node) {
      if (!node || typeof node !== "object" || seenObjects.has(node)) return;
      seenObjects.add(node);

      const alert = normalizeAlert(node);
      if (alert) {
        const key = alertKey(alert);
        if (!seenAlerts.has(key)) {
          seenAlerts.add(key);
          alerts.push(alert);
        }
      }

      if (Array.isArray(node)) {
        node.forEach(visit);
      } else {
        Object.values(node).forEach(visit);
      }
    }

    visit(value);
    return alerts;
  }

  function extractEmbeddedJson(html) {
    const values = [];
    const re = /<script\b[^>]*data-target=["']react-app\.embeddedData["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) {
      const text = match[1].trim();
      if (!text) continue;
      try {
        values.push(JSON.parse(text));
      } catch (_) {
        // Ignore malformed/non-JSON embedded data and let the HTML fallback run.
      }
    }
    return values;
  }

  function extractJsonValues(text, contentType) {
    const values = [];
    const type = String(contentType || "").toLowerCase();
    const trimmed = String(text || "").trim();
    if (!trimmed) return values;

    if (type.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        values.push(JSON.parse(trimmed));
      } catch (_) {
        // Some GitHub responses advertise JSON but contain HTML. Continue below.
      }
    }

    extractEmbeddedJson(trimmed).forEach((value) => values.push(value));
    return values;
  }

  function extractAlertsFromText(text, contentType) {
    const alerts = [];
    const seen = new Set();
    extractJsonValues(text, contentType).forEach((json) => {
      extractAlertsFromJson(json).forEach((alert) => {
        const key = alertKey(alert);
        if (seen.has(key)) return;
        seen.add(key);
        alerts.push(alert);
      });
    });
    return alerts;
  }

  function dependabotRouteFromUrl(urlValue) {
    const url = new URL(urlValue);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "security" || parts[3] !== "dependabot") {
      throw new Error("Not on a repository Dependabot alerts page");
    }
    return {
      origin: url.origin,
      pathname: `/${parts[0]}/${parts[1]}/security/dependabot`,
    };
  }

  function buildInitialUrl(locationHref) {
    const route = dependabotRouteFromUrl(locationHref);
    const url = new URL(route.pathname, route.origin);
    url.searchParams.set("query", "is:open");
    return url.toString();
  }

  function decodeHtmlAttribute(value) {
    return String(value || "")
      .replace(/&amp;/gi, "&")
      .replace(/&#0*38;/gi, "&")
      .replace(/&#x0*26;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/gi, "'")
      .replace(/&#x0*27;/gi, "'");
  }

  function validateNextUrl(candidate, currentUrl) {
    if (!candidate) return null;
    let next;
    let currentRoute;
    try {
      next = new URL(decodeHtmlAttribute(candidate), currentUrl);
      currentRoute = dependabotRouteFromUrl(currentUrl);
    } catch (_) {
      return null;
    }

    if (next.origin !== currentRoute.origin) return null;
    if (next.pathname.replace(/\/$/, "") !== currentRoute.pathname) return null;
    return next.toString();
  }

  function getHtmlAttribute(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    );
    const match = re.exec(tag);
    return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
  }

  function findNextInLinkHeader(linkHeader, currentUrl) {
    const header = String(linkHeader || "");
    const re = /<([^>]+)>\s*;([^,]*)/g;
    let match;
    while ((match = re.exec(header))) {
      if (!/\brel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|'[^']*\bnext\b[^']*'|next)(?:\s*;|\s*$)/i.test(match[2])) {
        continue;
      }
      const validated = validateNextUrl(match[1], currentUrl);
      if (validated) return validated;
    }
    return null;
  }

  function findPaginationData(value) {
    const seen = new Set();
    let directNext = null;

    function visit(node) {
      if (!node || typeof node !== "object" || seen.has(node) || directNext) return;
      seen.add(node);

      if (!Array.isArray(node)) {
        for (const key of ["next", "nextUrl", "next_url", "nextPageUrl", "next_page_url"]) {
          if (typeof node[key] === "string" && node[key]) {
            directNext = node[key];
            return;
          }
        }
      }

      if (Array.isArray(node)) {
        node.forEach(visit);
      } else {
        Object.values(node).forEach(visit);
      }
    }

    visit(value);
    return { directNext };
  }

  function findNextInJson(text, contentType, currentUrl) {
    for (const value of extractJsonValues(text, contentType)) {
      const { directNext } = findPaginationData(value);
      if (!directNext) continue;
      const validated = validateNextUrl(directNext, currentUrl);
      if (validated) return validated;
    }
    return null;
  }

  function htmlVisibleText(value) {
    return decodeHtmlAttribute(
      String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function findNextInHtml(html, currentUrl) {
    const text = String(html || "");
    const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(text))) {
      const anchor = match[0];
      const openTagMatch = /^<a\b[^>]*>/i.exec(anchor);
      if (!openTagMatch) continue;
      const tag = openTagMatch[0];
      const href = getHtmlAttribute(tag, "href");
      if (!href) continue;

      const rel = getHtmlAttribute(tag, "rel");
      const ariaLabel = getHtmlAttribute(tag, "aria-label");
      const className = getHtmlAttribute(tag, "class");
      const visibleText = htmlVisibleText(anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
      const isNext =
        /(?:^|\s)next(?:\s|$)/i.test(rel) ||
        /(?:^|\b)next(?:\s+page)?(?:\b|$)/i.test(ariaLabel.trim()) ||
        /(?:^|\s)next_page(?:\s|$)/i.test(className) ||
        /^next(?:\s+page)?$/i.test(visibleText);
      if (!isNext) continue;

      const validated = validateNextUrl(href, currentUrl);
      if (validated) return validated;
    }
    return null;
  }

  function findNextUrl({ currentUrl, response, text, contentType }) {
    if (!currentUrl) throw new Error("currentUrl is required");

    const linkHeader =
      response && response.headers && typeof response.headers.get === "function"
        ? response.headers.get("link")
        : "";

    return (
      findNextInLinkHeader(linkHeader, currentUrl) ||
      findNextInJson(text, contentType, currentUrl) ||
      findNextInHtml(text, currentUrl) ||
      null
    );
  }

  async function collectAllDependabotAlerts(options) {
    const {
      locationHref,
      fetchImpl,
      htmlAlertExtractor,
      htmlNextExtractor,
      initialPage,
      maxRequests = 500,
    } = options || {};

    if (!locationHref) throw new Error("locationHref is required");
    if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new Error("maxRequests must be a positive integer");
    }

    const initialUrl = buildInitialUrl(locationHref);
    const all = [];
    const seenAlerts = new Set();
    const visitedUrls = new Set();
    let requestCount = 0;

    function addAlerts(alerts) {
      for (const alert of alerts || []) {
        const normalized = normalizeAlert(alert) || alert;
        if (!normalized || !normalized.title) continue;
        const key = alertKey(normalized);
        if (seenAlerts.has(key)) continue;
        seenAlerts.add(key);
        all.push(normalized);
      }
    }

    let currentUrl = initialUrl;
    if (initialPage && Array.isArray(initialPage.alerts)) {
      addAlerts(initialPage.alerts);
      visitedUrls.add(initialUrl);
      currentUrl = initialPage.nextUrl
        ? validateNextUrl(initialPage.nextUrl, initialUrl)
        : null;
      if (initialPage.nextUrl && !currentUrl) {
        throw new Error("Rendered Dependabot next URL was not on the same repository alerts route");
      }
    }

    while (currentUrl && requestCount < maxRequests) {
      if (visitedUrls.has(currentUrl)) break;
      visitedUrls.add(currentUrl);
      requestCount += 1;

      const response = await fetchImpl(currentUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "text/html, application/xhtml+xml, application/json;q=0.9, */*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status} while fetching Dependabot alerts`);
      }

      const text = await response.text();
      const contentType =
        response.headers && typeof response.headers.get === "function"
          ? response.headers.get("content-type") || ""
          : "";

      let pageAlerts = extractAlertsFromText(text, contentType);
      if (pageAlerts.length === 0 && typeof htmlAlertExtractor === "function") {
        pageAlerts = htmlAlertExtractor(text, currentUrl) || [];
      }
      addAlerts(pageAlerts);

      let nextUrl = findNextUrl({ currentUrl, response, text, contentType });
      if (!nextUrl && typeof htmlNextExtractor === "function") {
        const candidate = htmlNextExtractor(text, currentUrl);
        nextUrl = validateNextUrl(candidate, currentUrl);
      }

      if (!nextUrl || visitedUrls.has(nextUrl)) {
        currentUrl = null;
        break;
      }
      currentUrl = nextUrl;
    }

    if (currentUrl && requestCount >= maxRequests) {
      throw new Error(
        `Stopped after ${maxRequests} Dependabot pagination requests before GitHub reached the final page`
      );
    }

    return all;
  }

  root.GhaDependabotFetch = {
    buildInitialUrl,
    collectAllDependabotAlerts,
    extractAlertsFromJson,
    extractAlertsFromText,
    findNextUrl,
    normalizeAlert,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
