// BALLDONTLIE FETCH TIMEOUT (2026-10-04):
// The Oct 4 morning run-all failed all 14 NFL games: the BallDontLie
// teams/games fetches inside fetchBDLTeamOffenseDefense had NO timeout, so a
// hung BDL endpoint hung the worker forever and the browser-side run died
// ("signal timed out" / "Failed to fetch"). Both BDL fetches must carry an
// AbortSignal timeout so a hung BDL fails fast into the existing
// try/catch -> null -> ESPN-fallback path instead of hanging the worker.
// Tests the REAL bundle code by extracting from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extractFn(name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error('function missing from bundle: ' + name);
  let i = m.index + m[0].length, pdepth = 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') pdepth++;
    if (src[i] === ')') { pdepth--; if (!pdepth) break; }
  }
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(m.index, j + 1);
}

function extractConst(name) {
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*'));
  if (!m) throw new Error('const missing from bundle: ' + name);
  let i = m.index + m[0].length;
  if (src[i] === '{' || src[i] === '[') {
    const open = src[i], close = open === '{' ? '}' : ']';
    let depth = 0, instr = false, q = '';
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (instr) { if (c === q && src[j - 1] !== '\\') instr = false; continue; }
      if (c === '"' || c === "'" || c === '`') { instr = true; q = c; continue; }
      if (c === open) depth++;
      if (c === close) { depth--; if (!depth) return src.slice(m.index, j + 1); }
    }
    throw new Error('unterminated literal for ' + name);
  }
  const end = src.indexOf(';', i);
  return src.slice(m.index, end + 1);
}

for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  globalThis[n] = (f) => f;
}

const fnSrc = extractFn('fetchBDLTeamOffenseDefense');

const bundle = [
  extractConst('BALLDONTLIE_SPORT_PATHS').replace(/^const /, 'var '),
  extractFn('normalizeTeamName'),
  extractFn('matchName'),
  extractFn('isCountableTeamGame'),
  extractFn('blendEarlySeasonTeamSides'),
  fnSrc,
].join('\n');
eval(bundle);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

// ---------- 1. Static: both BDL fetches carry an AbortSignal timeout ------
const teamsFetch = fnSrc.match(/fetch\(`https:\/\/api\.balldontlie\.io\/\$\{sport\}\/v1\/teams`[^)]*\)/);
check('teams fetch exists', !!teamsFetch);
check('teams fetch has AbortSignal.timeout', !!teamsFetch && /AbortSignal\.timeout\(\d+\)/.test(teamsFetch[0]), teamsFetch && teamsFetch[0].slice(0, 120));

const gamesFetch = fnSrc.match(/const gamesRes = await fetch\(url,[^)]*\)/);
check('games fetch exists', !!gamesFetch);
check('games fetch has AbortSignal.timeout', !!gamesFetch && /AbortSignal\.timeout\(\d+\)/.test(gamesFetch[0]), gamesFetch && gamesFetch[0].slice(0, 120));

// Timeout values are sane (bounded, not zero, not absurdly long)
for (const [label, m] of [['teams', teamsFetch], ['games', gamesFetch]]) {
  const t = m && m[0].match(/AbortSignal\.timeout\((\d+)\)/);
  const ms = t ? Number(t[1]) : 0;
  check(label + ' timeout is bounded (1s..60s)', ms >= 1000 && ms <= 60000, ms);
}

// ---------- 2. Behavioral: a hung BDL fails fast into null ---------------
// (proves the worker can no longer hang forever on BDL; the caller falls
// back to ESPN when this returns null)
async function main() {
  const realFetch = globalThis.fetch;
  // Hang forever, like an unresponsive upstream — but honor the abort
  // signal, the way a real fetch implementation does.
  globalThis.fetch = (url, opts = {}) => new Promise((_, reject) => {
    const sig = opts && opts.signal;
    if (sig) {
      if (sig.aborted) return reject(sig.reason);
      sig.addEventListener('abort', () => reject(sig.reason), { once: true });
    }
  });
  const env = { BALLDONTLIE_API_KEY: 'test-key' };
  const start = Date.now();
  let result, threw = null;
  try {
    result = await Promise.race([
      fetchBDLTeamOffenseDefense(env, 'NFL', 'Kansas City Chiefs'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG: did not resolve within 40s')), 40000)),
    ]);
  } catch (e) { threw = e; }
  const elapsed = Date.now() - start;
  globalThis.fetch = realFetch;

  check('hung BDL resolves instead of hanging forever', !threw, threw && threw.message);
  check('hung BDL returns null (ESPN fallback path)', result === null, result);
  check('hung BDL resolves in bounded time (<40s)', elapsed < 40000, elapsed + 'ms');

  // Sanity: missing API key still short-circuits to null without fetching.
  const r2 = await fetchBDLTeamOffenseDefense({}, 'NFL', 'Kansas City Chiefs');
  check('missing BDL key returns null', r2 === null, r2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
