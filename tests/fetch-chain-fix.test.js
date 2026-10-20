// Fetch-chain fix (2026-10-18, SAM 1.7.3): the ESPN bypass is Cloudflare
// Browser Rendering ONLY (ZenRows/ScrapingAnt legs removed), the bypass
// runs at most once per ESPN call, and server-side deadlines exist
// (requestMeta 120s per model call; /api/chat 270s cumulative).
// Runs under plain node. Tests the REAL functions extracted from
// ../src/index.js (never copies).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let p = src.indexOf('(', start), pd = 0, qi = p;
  for (; qi < src.length; qi++) {
    if (src[qi] === '(') pd++;
    if (src[qi] === ')') { pd--; if (!pd) break; }
  }
  let i = src.indexOf('{', qi), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('ok - ' + name); },
    (e) => { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
  );
}

// ---- environment stubs -------------------------------------------------
global.caches = { default: { match: async () => null, put: async () => {} } };
let directBlockedMarks = 0;
function markEspnDirectBlocked() { directBlockedMarks++; }

eval(extract('isEspnBlockedStatus'));
eval(extract('getEspnCacheTtlSeconds'));
eval(extract('getEspnCached'));
eval(extract('putEspnCached'));
eval(extract('parseEspnJsonBody'));
eval(extract('fetchEspnViaBrowserRender'));
eval(extract('tryEspnBypassFallbacks'));
eval(extract('fetchEspnWithRetry'));

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const realFetch = global.fetch;
let cfCalls = 0, thirdPartyCalls = 0, cfShouldFail = false;

function installFetch() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('zenrows.com') || u.includes('scrapingant.com')) { thirdPartyCalls++; throw new Error('third-party leg must never be called'); }
    if (u.startsWith('https://api.cloudflare.com/')) {
      cfCalls++;
      if (cfShouldFail) return { ok: false, status: 500, text: async () => 'cf down' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ result: JSON.stringify({ events: [] }), success: true }) };
    }
    // ESPN direct: blocked
    return { ok: false, status: 403, text: async () => '' };
  };
}

(async () => {
  await check('bypass chain calls ONLY Cloudflare Browser Rendering, even with ZenRows/ScrapingAnt keys present', async () => {
    cfCalls = 0; thirdPartyCalls = 0; cfShouldFail = false; installFetch();
    const env = { ZENROWS_API_KEY: 'z', SCRAPINGANT_API_KEY: 's', CLOUDFLARE_API_TOKEN: 'cf' };
    const res = await tryEspnBypassFallbacks(env, ESPN_URL);
    assert(res && res.ok, 'expected an ok Response from the Browser Rendering leg');
    assert.strictEqual(cfCalls, 1, 'Cloudflare leg must run exactly once');
    assert.strictEqual(thirdPartyCalls, 0, 'no ZenRows/ScrapingAnt call may happen');
  });

  await check('bypass chain source has no ZenRows/ScrapingAnt legs left', () => {
    const body = extract('tryEspnBypassFallbacks');
    assert(!/fetchEspnViaZenRows\s*\(/.test(body), 'ZenRows leg still in the chain');
    assert(!/fetchEspnViaScrapingAnt\s*\(/.test(body), 'ScrapingAnt leg still in the chain');
    assert(/fetchEspnViaBrowserRender\s*\(/.test(body), 'Browser Rendering leg missing');
  });

  await check('UFC HTML fetcher is Browser Rendering only', () => {
    const body = extract('fetchHtmlViaAntibot');
    assert(/fetchHtmlViaBrowserRender\s*\(/.test(body), 'HTML path must use Browser Rendering');
    assert(!/fetchHtmlViaZenRows\s*\(/.test(body), 'ZenRows HTML leg still present');
    assert(!/fetchHtmlViaScrapingAnt\s*\(/.test(body), 'ScrapingAnt HTML leg still present');
  });

  await check('bypass runs at most once per fetchEspnWithRetry call (blocked branch reuses the guard)', async () => {
    cfCalls = 0; thirdPartyCalls = 0; cfShouldFail = true; installFetch();
    const env = { ZENROWS_API_KEY: 'z', SCRAPINGANT_API_KEY: 's', CLOUDFLARE_API_TOKEN: 'cf' };
    const res = await fetchEspnWithRetry(ESPN_URL, {}, { env, cacheable: false });
    assert(res && res.status === 403, 'with the bypass failed, the direct 403 response is returned');
    assert.strictEqual(cfCalls, 1, 'bypass chain must run exactly once across the first attempt and the blocked branch, got ' + cfCalls);
    assert.strictEqual(thirdPartyCalls, 0, 'no third-party leg may run');
  });

  await check('fetchEspnCoreWithRetry carries the same run-once guard', () => {
    const body = extract('fetchEspnCoreWithRetry');
    assert(/runBypassOnce/.test(body), 'core fetcher missing the bypass-once guard');
    const withRetry = extract('fetchEspnWithRetry');
    assert(/runBypassOnce/.test(withRetry), 'withRetry missing the bypass-once guard');
  });

  await check('requestMeta caps each model call at 120 seconds', () => {
    const body = extract('requestMeta');
    assert(/AbortSignal\.timeout\(120e3\)/.test(body), 'requestMeta has no 120s AbortSignal timeout');
  });

  await check('/api/chat carries the 270-second cumulative deadline with a readable timeout response', () => {
    assert(/CHAT_DEADLINE_MS = 270e3/.test(src), 'cumulative deadline constant missing');
    assert(/chatDeadlineResponse/.test(src), 'deadline response helper missing');
    assert(/Prediction timed out/.test(src), 'readable timeout error text missing');
  });

  global.fetch = realFetch;
  console.log(`\nfetch-chain-fix: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
