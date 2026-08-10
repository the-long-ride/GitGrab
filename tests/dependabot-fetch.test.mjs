import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dependabot-fetch.js', import.meta.url), 'utf8');
const context = { console, URL, setTimeout, clearTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'dependabot-fetch.js' });

const api = context.GhaDependabotFetch;
assert.ok(api, 'GhaDependabotFetch global should be exported');

function response(body, { status = 200, contentType = 'application/json', headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries({ 'content-type': contentType, ...headers }).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalizedHeaders[name.toLowerCase()] ?? null },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function makeAlert(number, overrides = {}) {
  return {
    number,
    state: 'open',
    dependency: {
      package: { ecosystem: 'npm', name: `pkg-${number}` },
      manifest_path: `locks/${number}/package-lock.json`,
    },
    security_advisory: { summary: `Vulnerability ${number}`, severity: 'high' },
    security_vulnerability: { severity: 'high' },
    html_url: `https://github.com/acme/widget/security/dependabot/${number}`,
    ...overrides,
  };
}

const alert1 = makeAlert(10, {
  dependency: {
    package: { ecosystem: 'npm', name: 'lodash' },
    manifest_path: 'package-lock.json',
  },
  security_advisory: { summary: 'Prototype Pollution in lodash', severity: 'high' },
  html_url: 'https://github.com/acme/widget/security/dependabot/10',
});

const alert2 = {
  number: 11,
  state: 'open',
  dependency: {
    package: { ecosystem: 'pip', name: 'requests' },
    manifest_path: 'requirements.txt',
  },
  securityAdvisory: { summary: 'Requests issue', severity: 'moderate' },
  securityVulnerability: { severity: 'moderate' },
  htmlUrl: 'https://github.com/acme/widget/security/dependabot/11',
};

const alert3 = {
  alertNumber: 12,
  state: 'open',
  dependency: {
    package: { ecosystem: 'Maven', name: 'org.example:lib' },
    manifestPath: 'pom.xml',
  },
  advisory: { summary: 'Example library vulnerability', severity: 'critical' },
  url: 'https://github.com/acme/widget/security/dependabot/12',
};

// RED: initial request must be canonical and independent of the current UI page/filter.
{
  const initial = api.buildInitialUrl(
    'https://github.com/acme/widget/security/dependabot?query=severity%3Acritical&page=7&after=STALE'
  );
  const parsed = new URL(initial);
  assert.equal(parsed.pathname, '/acme/widget/security/dependabot');
  assert.equal(parsed.searchParams.get('query'), 'is:open');
  assert.equal(parsed.searchParams.has('page'), false);
  assert.equal(parsed.searchParams.has('after'), false);
}

// RED: HTTP Link rel=next is authoritative pagination.
{
  const currentUrl = 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen';
  const next = api.findNextUrl({
    currentUrl,
    response: response('', {
      contentType: 'text/html',
      headers: {
        link: '<https://github.com/acme/widget/security/dependabot?query=is%3Aopen&after=CURSOR_A>; rel="next", <https://github.com/acme/widget/security/dependabot?query=is%3Aopen&after=LAST>; rel="last"',
      },
    }),
    text: '',
    contentType: 'text/html',
  });
  assert.equal(new URL(next).searchParams.get('after'), 'CURSOR_A');
}

// RED: GitHub HTML next link can drive pagination and HTML entities are decoded.
{
  const currentUrl = 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen';
  const html = '<nav><a rel="next" href="/acme/widget/security/dependabot?query=is%3Aopen&amp;after=CURSOR_B">Next</a></nav>';
  const next = api.findNextUrl({
    currentUrl,
    response: response(html, { contentType: 'text/html' }),
    text: html,
    contentType: 'text/html',
  });
  const parsed = new URL(next);
  assert.equal(parsed.searchParams.get('after'), 'CURSOR_B');
  assert.equal(parsed.searchParams.get('query'), 'is:open');
}

// RED: web-route JSON pageInfo must NOT be converted into REST `after` cursors.
{
  const currentUrl = 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen';
  const body = { payload: { pageInfo: { hasNextPage: true, endCursor: 'OPAQUE_CURSOR_C' } } };
  const next = api.findNextUrl({
    currentUrl,
    response: response(body),
    text: JSON.stringify(body),
    contentType: 'application/json',
  });
  assert.equal(next, null);
}

// RED: never follow pagination outside the same repository Dependabot list route.
{
  const currentUrl = 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen';
  const html = '<a rel="next" href="https://github.com/other/repo/security/dependabot?after=EVIL">Next</a>';
  const next = api.findNextUrl({
    currentUrl,
    response: response(html, { contentType: 'text/html' }),
    text: html,
    contentType: 'text/html',
  });
  assert.equal(next, null);
}

// RED: repository-wide collection follows opaque server-provided cursors and gets 100+ alerts.
{
  const firstPage = Array.from({ length: 50 }, (_, i) => makeAlert(i + 1));
  const secondPage = Array.from({ length: 50 }, (_, i) => makeAlert(i + 51));
  const thirdPage = Array.from({ length: 5 }, (_, i) => makeAlert(i + 101));
  const calls = [];

  function htmlPage(alerts, nextAfter = null) {
    const embedded = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { alerts } })}</script>`;
    const next = nextAfter
      ? `<a aria-label="Next Page" href="/acme/widget/security/dependabot?query=is%3Aopen&amp;after=${nextAfter}">Next</a>`
      : '';
    return `<!doctype html><html><body>${embedded}${next}</body></html>`;
  }

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const after = new URL(url).searchParams.get('after');
    if (after === null) return response(htmlPage(firstPage, 'CURSOR_50'), { contentType: 'text/html' });
    if (after === 'CURSOR_50') return response(htmlPage(secondPage, 'CURSOR_100'), { contentType: 'text/html' });
    if (after === 'CURSOR_100') return response(htmlPage(thirdPage), { contentType: 'text/html' });
    throw new Error(`unexpected cursor: ${after}`);
  };

  const alerts = await api.collectAllDependabotAlerts({
    locationHref: 'https://github.com/acme/widget/security/dependabot?query=severity%3Ahigh&page=4',
    fetchImpl,
    maxRequests: 10,
  });

  assert.equal(alerts.length, 105, 'collects every alert across server-provided cursor pages');
  assert.equal(alerts[0].number, 1);
  assert.equal(alerts.at(-1).number, 105);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ url }) => new URL(url).searchParams.get('after')), [null, 'CURSOR_50', 'CURSOR_100']);
  for (const { url, options } of calls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://github.com');
    assert.equal(parsed.pathname, '/acme/widget/security/dependabot');
    assert.equal(parsed.searchParams.has('page'), false, 'collector never synthesizes page numbers');
    assert.equal(options.credentials, 'include');
    assert.match(options.headers.Accept, /^text\/html/, 'web route should request normal GitHub HTML first');
    assert.equal('X-Requested-With' in options.headers, false, 'do not opt into an XHR/partial response mode');
  }
}


// RED: Primer/GitHub pagination may identify Next by visible text only.
{
  const currentUrl = 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen';
  const html = '<nav aria-label="Pagination"><a href="/acme/widget/security/dependabot?query=is%3Aopen&amp;page=2"><span>Next</span></a></nav>';
  const next = api.findNextUrl({
    currentUrl,
    response: response(html, { contentType: 'text/html' }),
    text: html,
    contentType: 'text/html',
  });
  assert.equal(new URL(next).searchParams.get('page'), '2');
}

// RED: a rendered first-page bootstrap must be reusable without refetching page one.
{
  const first = makeAlert(1);
  const second = makeAlert(2);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(`<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { alerts: [second] } })}</script>`, { contentType: 'text/html' });
  };

  const alerts = await api.collectAllDependabotAlerts({
    locationHref: 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen',
    fetchImpl,
    initialPage: {
      alerts: [first],
      nextUrl: 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen&page=2',
    },
  });

  assert.deepEqual(Array.from(alerts, (alert) => alert.number), [1, 2]);
  assert.equal(calls.length, 1, 'rendered page one should not be fetched again');
  assert.equal(new URL(calls[0]).searchParams.get('page'), '2');
}

// RED: DOMParser-based next-link extraction can drive later fetched pages when raw helper parsing cannot.
{
  const first = makeAlert(1);
  const second = makeAlert(2);
  const third = makeAlert(3);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = new URL(url).searchParams.get('page');
    const alerts = page === '2' ? [second] : [third];
    return response(`<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { alerts } })}</script>`, { contentType: 'text/html' });
  };
  const htmlNextExtractor = (_html, currentUrl) => {
    const page = new URL(currentUrl).searchParams.get('page');
    if (page === '2') return 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen&page=3';
    return null;
  };

  const alerts = await api.collectAllDependabotAlerts({
    locationHref: 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen',
    fetchImpl,
    initialPage: {
      alerts: [first],
      nextUrl: 'https://github.com/acme/widget/security/dependabot?query=is%3Aopen&page=2',
    },
    htmlNextExtractor,
  });

  assert.deepEqual(Array.from(alerts, (alert) => alert.number), [1, 2, 3]);
  assert.equal(calls.length, 2);
}

// Existing normalization behavior remains intact.
{
  const alerts = api.extractAlertsFromJson({ payload: { alerts: [alert1, alert2, alert3] } });
  assert.equal(alerts.length, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(alerts[0])),
    {
      number: 10,
      title: 'Prototype Pollution in lodash',
      priority: 'High',
      detectedIn: 'lodash (npm)',
      file: 'package-lock.json',
      href: 'https://github.com/acme/widget/security/dependabot/10',
    }
  );
  assert.equal(alerts[1].priority, 'Moderate');
  assert.equal(api.normalizeAlert({ ...alert1, security_vulnerability: { severity: 'medium' } }).priority, 'Moderate');
  assert.equal(alerts[2].file, 'pom.xml');
}

{
  const html = `<!doctype html><html><body>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { alerts: [alert1] } })}</script>
  </body></html>`;
  const alerts = api.extractAlertsFromText(html, 'text/html');
  assert.equal(alerts.length, 1, 'extracts alerts from GitHub react-app embedded JSON');
  assert.equal(alerts[0].number, 10);
}

{
  const nested = {
    payload: {
      unrelated: { number: 999, title: 'not an alert' },
      nested: [{ wrapper: { ...alert1 } }, { wrapper: { ...alert1 } }],
    },
  };
  const alerts = api.extractAlertsFromJson(nested);
  assert.equal(alerts.length, 1, 'deduplicates the same alert and ignores unrelated numbered objects');
  assert.equal(alerts[0].number, 10);
}

// Repeated next URL must terminate instead of looping forever.
{
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const html = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { alerts: [alert1] } })}</script>` +
      `<a rel="next" href="${url}">Next</a>`;
    return response(html, { contentType: 'text/html' });
  };
  const alerts = await api.collectAllDependabotAlerts({
    locationHref: 'https://github.com/acme/widget/security/dependabot',
    fetchImpl,
    maxRequests: 10,
  });
  assert.equal(alerts.length, 1);
  assert.equal(calls, 1, 'repeated next URL is not fetched twice');
}

{
  const fetchImpl = async () => response({ message: 'Forbidden' }, { status: 403 });
  await assert.rejects(
    () => api.collectAllDependabotAlerts({
      locationHref: 'https://github.com/acme/widget/security/dependabot',
      fetchImpl,
    }),
    /GitHub returned 403/
  );
}

console.log('dependabot-fetch tests passed');
