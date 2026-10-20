// Slate board resilience (2026-10-17): budgets on every link of the
// /api/slate build chain after three straight board loads died with no
// response ("Failed to fetch") on a slow-upstream morning.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; } else { failed++; console.log('FAIL: ' + name); } }
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing fn ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error('unterminated ' + name);
}
eval(extractFn('withSlateBudget'));

(async () => {
  check('fast work beats the budget', (await withSlateBudget(Promise.resolve(7), 1000, () => -1)) === 7);
  check('slow work falls back at the budget', (await withSlateBudget(new Promise((r) => setTimeout(() => r(7), 200)), 20, () => -1)) === -1);
  let rejected = null;
  try { await withSlateBudget(Promise.reject(new Error('boom')), 1000, () => -1); } catch (e) { rejected = e; }
  check('rejections still propagate (fail loud, not silent)', !!rejected && rejected.message === 'boom');

  const slate = src.slice(src.indexOf('async function buildDailySlate('), src.indexOf('async function fetchOneSlateLeague('));
  check('slate build wraps leagues in withSlateBudget', slate.includes('withSlateBudget('));
  check('slate league budget is 20s', slate.includes('20000'));
  check('budget fallback names the league error', slate.includes('scoreboard timed out (20s budget)'));
  const one = src.slice(src.indexOf('async function fetchOneSlateLeague('), src.indexOf('async function fetchOneSlateLeague(') + 700);
  check('slate league fetch is directFirst', one.includes('directFirst: true'));
  const espn = src.slice(src.indexOf('async function fetchEspnWithRetry('), src.indexOf('async function fetchEspnWithRetry(') + 1800);
  check('fetchEspnWithRetry accepts directFirst', espn.includes('directFirst = false'));
  check('pre-bypass is gated on !directFirst', espn.includes('if (!directFirst && env &&'));
  const pend = src.slice(src.indexOf('async function fetchPendingSlateRecords('), src.indexOf('async function fetchPendingSlateRecords(') + 1200);
  check('pending-records Airtable fetch carries a 15s timeout', pend.includes('signal: AbortSignal.timeout(15000)'));
  check('route races the build at 55s with a readable error', src.includes('Board build timed out (55s)') && src.includes('55000'));
  const logged = src.slice(src.indexOf('async function fetchTodaysLoggedRecords('), src.indexOf('__name(fetchTodaysLoggedRecords'));
  check('logged-detection tries the bounded pending query first', logged.indexOf('fetchPendingSlateRecords(env, provider)') >= 0 && logged.indexOf('fetchPendingSlateRecords(env, provider)') < logged.indexOf('loadBetsReplica(env)'));
  check('logged-detection keeps the replica read as fallback', logged.includes('loadBetsReplica(env)'));
  check('logged-detection date-filters both paths', (logged.match(/onlyToday\(/g) || []).length >= 2);
  check('logged-detection distrusts an empty today-set and falls back', logged.includes('pendingToday.length'));
  eval(extractFn('isGrokModelLabel'));
  eval(extractFn('isMetaModelLabel'));
  eval(extractFn('matchesProviderLabel'));
  check('classifier recognizes the current SAM stamp as meta', matchesProviderLabel('SAM 1.7.2', 'meta') === true);
  check('classifier still recognizes the 1.6-era stamp', matchesProviderLabel('ParlayKings 1.6', 'meta') === true);
  check('classifier keeps SAM XAI stamps out of meta', matchesProviderLabel('SAM XAI 2.1', 'meta') === false);
  const bds = extractFn('buildDailySlate');
  check('board build reads the KV cache before building', bds.indexOf('slate-board:') !== -1 && bds.indexOf('kv.get') < bds.indexOf('fetchTodaysLoggedRecords'));
  check('board build caches with a 1-hour KV TTL', bds.includes('expirationTtl: 3600'));
  check('stale boards are served and flagged, never blocking the load', bds.includes('_stale = true') && bds.includes('ageMs > 300000'));
  check('route refreshes a stale board in the background', src.includes('ctx.waitUntil(buildDailySlate(env, dateStr, { fresh: true })'));
  check('route exposes the fresh bypass', src.includes('url.searchParams.get("fresh") === "1"'));
  console.log(`slate-resilience: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
