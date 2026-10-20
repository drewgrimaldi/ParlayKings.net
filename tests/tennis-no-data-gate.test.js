// Tennis no-data gate (facts-and-stats law, 2026-09-28): when neither player
// has verifiable data (no rank and no season W/L for both),
// getTennisMatchupPowerRatings returns null so the tennis branch declines via
// CANNOT_VERIFY instead of running the sim on pure estimates. Tests the REAL
// bundle function by extracting it from ../src/index.js (never a copy). Runs
// under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
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

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}

async function main() {
  // Stub the two dependencies: no network, no ESPN.
  let statsStub = { a: null, b: null };
  async function fetchTennisPlayerStats(playerName) {
    return playerName === 'A' ? statsStub.a : statsStub.b;
  }
  async function getTennisSurfaceAdjustment() { return {}; }
  eval(extract('getTennisMatchupPowerRatings'));

  // No verifiable data on either player -> null -> branch declines.
  statsStub = { a: null, b: null };
  check('no data on either player -> ratings null (decline)',
    await getTennisMatchupPowerRatings('A', 'B', 'WTA', null, null), null);

  // One side has real data -> object (existing thin-data path still applies).
  statsStub = { a: { rank: 5, winPct: 70 }, b: null };
  const r = await getTennisMatchupPowerRatings('A', 'B', 'WTA', null, null);
  check('one side with data -> ratings object, not null', r !== null && typeof r === 'object', true);
  check('real rank survives', r && r.rankA, 5);

  // Both sides have data -> object.
  statsStub = { a: { rank: 5, winPct: 70 }, b: { rank: 12, winPct: 65 } };
  check('both sides with data -> ratings object',
    (await getTennisMatchupPowerRatings('A', 'B', 'WTA', null, null)) !== null, true);

  if (fails) { console.log(`\n${fails} CHECK(S) FAILED`); process.exit(1); }
  console.log('\nALL CHECKS PASSED');
}

main().catch((e) => { console.error('THREW:', e); process.exit(1); });
