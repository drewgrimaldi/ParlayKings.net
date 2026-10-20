// Tennis importance weights (Drew's call 2026-09-23): hold % > surface > set
// format, with rank / recent form / season W-L demoted to tiebreak-level
// nudges. Tests the REAL bundle functions by extracting them from
// ../src/index.js (never a copy). Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
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

// GRAND_SLAM_NAME_RE is a bundle var statement, not a function — extract the statement itself.
function extractVar(name) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start < 0) throw new Error('var missing from bundle: ' + name);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

var CONSERVATISM_SHRINKAGE = 0.40; // matches bundle default; tests pass shrinkage explicitly anyway
// simulateTennisSet now banks an optional WTA edge inside the loop — define
// the bundle's scale const so the extracted sim evaluates. Undefined edge
// keeps every legacy tennis expectation exactly as before.
var WTA_EDGE_HOLD_SCALE = 0.05; // matches bundle; WTA-only, ATP/ITF pass no edge
eval(extractVar('GRAND_SLAM_NAME_RE'));
for (const fn of ['normalizeLeague', 'isTennisGrandSlam', 'tennisMatchBestOf', 'tennisServeHoldProb', 'simulateTennisSet', 'runTennisMatchSimulation']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}
function checkClose(desc, actual, expected, eps) {
  const ok = Math.abs(actual - expected) <= (eps || 1e-9);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
}
function checkGt(desc, actual, floor) {
  const ok = actual > floor;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected > ' + floor + ')'));
}
function checkLt(desc, actual, ceil) {
  const ok = actual < ceil;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected < ' + ceil + ')'));
}

// ---------- (h) BO5/BO3 assignments unchanged ----------
check('ATP Wimbledon -> best of 5', tennisMatchBestOf('TENNIS', 'Wimbledon'), 5);
check('ATP US Open -> best of 5', tennisMatchBestOf('TENNIS', 'US Open'), 5);
check('ATP non-Slam -> best of 3', tennisMatchBestOf('TENNIS', 'Chengdu Open'), 3);
check('WTA Slam -> best of 3', tennisMatchBestOf('WTA', 'Wimbledon'), 3);
check('unknown tournament -> best of 3', tennisMatchBestOf('TENNIS', null), 3);

// ---------- (a) a clear hold-% gap on the same surface decides the match ----------
const simClear = runTennisMatchSimulation({ holdA: 0.88, holdB: 0.78, bestOf: 3, trials: 50000, shrinkage: 1 });
checkGt('0.88 vs 0.78 hold: A wins the sim decisively', simClear.winPctA, 75);
checkLt('0.88 vs 0.78 hold: B is well beaten', simClear.winPctB, 25);

// ---------- (b) surface flips a close hold-% matchup the right way ----------
// Same base holds: A 0.82, B 0.79. A is a grass-court player, B a clay-court player.
const clayA = tennisServeHoldProb({ actualHoldPct: 0.82, usedSurfaceHold: false, winPct: 60, surfaceWinPct: 35, surfaceMatches: 10, surfaceGroup: 'clay' });
const clayB = tennisServeHoldProb({ actualHoldPct: 0.79, usedSurfaceHold: false, winPct: 55, surfaceWinPct: 80, surfaceMatches: 10, surfaceGroup: 'clay' });
const grassA = tennisServeHoldProb({ actualHoldPct: 0.82, usedSurfaceHold: false, winPct: 60, surfaceWinPct: 85, surfaceMatches: 10, surfaceGroup: 'grass' });
const grassB = tennisServeHoldProb({ actualHoldPct: 0.79, usedSurfaceHold: false, winPct: 55, surfaceWinPct: 35, surfaceMatches: 10, surfaceGroup: 'grass' });
checkGt('clay: B (clay specialist) holds better than A despite weaker base', clayB, clayA);
checkGt('grass: A (grass specialist) holds better than B', grassA, grassB);
const simClay = runTennisMatchSimulation({ holdA: clayA, holdB: clayB, bestOf: 3, trials: 50000, shrinkage: 1 });
const simGrass = runTennisMatchSimulation({ holdA: grassA, holdB: grassB, bestOf: 3, trials: 50000, shrinkage: 1 });
checkGt('clay: B wins the match', simClay.winPctB, 55);
checkGt('grass: A wins the match', simGrass.winPctA, 65);

// ---------- (c) BO5 compounds the stronger server's edge (real set math) ----------
const simBO3 = runTennisMatchSimulation({ holdA: 0.85, holdB: 0.78, bestOf: 3, trials: 50000, shrinkage: 1 });
const simBO5 = runTennisMatchSimulation({ holdA: 0.85, holdB: 0.78, bestOf: 5, trials: 50000, shrinkage: 1 });
checkGt('BO5 win prob exceeds BO3 win prob for the stronger server', simBO5.winPctA - simBO3.winPctA, 2);
checkGt('BO3 favorite still favored (no format fudge)', simBO3.winPctA, 55);

// ---------- (d) a big rank gap cannot overrule a big hold-% gap ----------
// A: world #2, no serve tape (fallback estimate). B: #120, real 87% hold tape.
const rankStarNoTape = tennisServeHoldProb({ rank: 2, winPct: 70 });
const journeymanTape = tennisServeHoldProb({ actualHoldPct: 0.87, rank: 120, winPct: 55 });
checkGt('real 87% hold tape beats a #2 rank with no tape', journeymanTape, rankStarNoTape);
checkLt('no-tape #2 estimate stays under 0.80 (compressed, not rank-driven)', rankStarNoTape, 0.80);
const simRank = runTennisMatchSimulation({ holdA: rankStarNoTape, holdB: journeymanTape, bestOf: 3, trials: 50000, shrinkage: 1 });
checkGt('sim picks the serve, not the rank', simRank.winPctB, 60);

// ---------- (e) recent form is a tiebreak-level nudge only ----------
// Halved from the old 0.015 coefficient: extremes now move hold by 0.00375,
// and the full 0-to-100 swing is 0.0075 total — it cannot overrule hold/surface.
checkClose('perfect recent form: +0.00375', tennisServeHoldProb({ actualHoldPct: 0.80, recentWinPct: 100 }), 0.80375);
checkClose('winless recent form: -0.00375', tennisServeHoldProb({ actualHoldPct: 0.80, recentWinPct: 0 }), 0.79625);
checkClose('neutral recent form: no nudge', tennisServeHoldProb({ actualHoldPct: 0.80, recentWinPct: 50 }), 0.80);

// ---------- (f) no-tape fallback: rank/W-L swing compressed ----------
const fbRank1 = tennisServeHoldProb({ rank: 1, winPct: 60 });
const fbRank100 = tennisServeHoldProb({ rank: 100, winPct: 60 });
checkClose('rank 1-vs-100 gap compressed to ~5pp (was ~10pp)', fbRank1 - fbRank100, 0.0495, 1e-6);
checkGt('rank-1 fallback estimate is sane (tour-average-ish)', fbRank1, 0.72);
checkLt('rank-1 fallback estimate is not inflated', fbRank1, 0.82);

// ---------- (g) surface rules intact: +/-0.06 cap, no double-count on real tape ----------
checkClose('grass + huge surface edge still capped at +0.06 total', tennisServeHoldProb({ actualHoldPct: 0.80, usedSurfaceHold: false, winPct: 40, surfaceWinPct: 100, surfaceMatches: 10, surfaceGroup: 'grass' }), 0.86);
checkClose('clay + terrible surface record still capped at -0.06 total', tennisServeHoldProb({ actualHoldPct: 0.80, usedSurfaceHold: false, winPct: 90, surfaceWinPct: 10, surfaceMatches: 10, surfaceGroup: 'clay' }), 0.74);
checkClose('real surface hold tape: no modifier on top (no double-count)', tennisServeHoldProb({ actualHoldPct: 0.83, usedSurfaceHold: true, winPct: 60, surfaceWinPct: 90, surfaceMatches: 10, surfaceGroup: 'grass' }), 0.83);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
