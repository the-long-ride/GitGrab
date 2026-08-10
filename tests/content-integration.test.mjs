import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const scripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(scripts.slice(0, 2), ['dependabot-fetch.js', 'content.js'], 'Dependabot fetch helper must load before content.js');
assert.equal(manifest.name, 'GitGrab', 'extension should ship under the GitGrab brand');
assert.equal(manifest.version, '1.0.1', 'GitGrab should ship as 1.0.1');

const helper = fs.readFileSync('dependabot-fetch.js', 'utf8');
assert.match(helper, /function buildInitialUrl\(/, 'collector should build a canonical first request');
assert.match(helper, /function findNextUrl\(/, 'collector should discover GitHub-provided next requests');
assert.doesNotMatch(helper, /searchParams\.set\(["']page["']/, 'helper must never synthesize page numbers');
assert.doesNotMatch(helper, /function buildPageUrl\(/, 'old page-number URL builder must be removed');

const popup = fs.readFileSync('popup.html', 'utf8');
assert.match(popup, />GitGrab<\/span>/, 'popup should display GitGrab');
assert.doesNotMatch(popup, /GHA Log Copier/, 'old product name should be removed from popup');

const content = fs.readFileSync('content.js', 'utf8');
assert.match(content, /GhaDependabotFetch\.collectAllDependabotAlerts/, 'content.js should use authenticated fetch collector');
assert.match(content, /htmlAlertExtractor/, 'content.js should retain HTML alert parsing');
assert.match(content, /htmlNextExtractor/, 'content.js should provide DOMParser-based pagination discovery');
assert.match(content, /initialPage/, 'content.js should bootstrap from the rendered first page when safe');
assert.match(content, /findRenderedDependabotNextUrl/, 'content.js should discover GitHub rendered Next links');
assert.doesNotMatch(content, /maxPages/, 'content script must not configure page-number pagination');
assert.match(content, /No access/, 'authorization failures should be visible on the button');
assert.match(content, /\[GitGrab\]/, 'debug prefix should use GitGrab');
assert.doesNotMatch(content, /GHA Log Copier/, 'old product name should be removed from content script');

console.log('content integration tests passed');
