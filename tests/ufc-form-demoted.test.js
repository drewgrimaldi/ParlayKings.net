// UFC recent performance as the 4th importance factor (Drew's call 2026-09-24):
// the 2026-09-23 "form is the bottom tier" demotion is SUPERSEDED. Recent
// Performance / Trajectory now carries a real 10% weight in the 15-factor
// Monte Carlo composite: winPct differential blended 70/30 with the
// round-by-round trajectory from the last 3 fights' fight-detail pages.
// The old 0.98-1.02 strike-volume multiplier and the tiebreak-only demotion
// are gone — form now moves the number like Drew asked.
// Tests the REAL bundle code by extracting from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
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

function extractVar(name) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start < 0) throw new Error('var missing from bundle: ' + name);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

// Bundler name-helpers referenced inside extracted functions — stub as identity.
for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  eval('var ' + n + ' = function (f) { return f; };');
}
eval(extractVar('UFC_WEIGHT_CLASS_SCALE'));
eval(extractVar('UFC_IMPORTANCE_WEIGHTS'));
eval(extractVar('UFC_ROUND_EDGE_SCALE'));
eval(extractVar('CONSERVATISM_SHRINKAGE'));
for (const fn of ['sampleNormal', 'ufcNum', 'ufcClampEdge', 'ufcFinishRate',
  'ufcHeightInches', 'ufcReachInches', 'ufcStanceType', 'ufcWeightClassScale',
  'ufcCountryKey', 'ufcSameCountry', 'ufcPhysicalNetEdge', 'ufcFinishMixScale',
  'ufcWeightClassFinishBias', 'ufcLastFiveTiebreak', 'ufcWeightedCompositeEdge',
  'runUFCMultiStatSimulation']) {
  eval(extract(fn));
}

const simSrc = extract('runUFCMultiStatSimulation');

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
function checkBetween(desc, actual, lo, hi) {
  const ok = actual > lo && actual < hi;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected between ' + lo + ' and ' + hi + ')'));
}

function baseFighter(over) {
  return Object.assign({
    strikeLPM: 4.5, strikeAccuracy: 46, takedownAvg: 1.2, takedownAccuracy: 40,
    submissionAvg: 0.3, sapm: 4.0, strikeDefense: 54, takedownDefense: 60,
    reach: 72, height: 70, stance: 'orthodox', age: 29,
    weightClass: 'Lightweight', country: 'United States', finishMix: null,
    recent: null, deep: null
  }, over);
}
const edgeOf = (a, b) => ufcWeightedCompositeEdge(a, b, null);

// ---------- (a) form is factor #13 at 10% in the weights table ----------
const formFactor = UFC_IMPORTANCE_WEIGHTS.find((f) => f.key === 'recentForm');
check('recentForm factor exists in the 15 weights', !!formFactor, true);
checkClose('recentForm weight is 3% (Drew 2026-10-05)', formFactor.weight, 0.03);

// ---------- (b) the old demotion is gone from the sim source ----------
check('no formA volume multiplier in sim', simSrc.includes('formA'), false);
check('no old 0.98-1.02 band in sim', simSrc.includes('0.98 + 0.04'), false);

// ---------- (c) winPct differential drives the factor ----------
checkClose('5-0 vs 0-5 -> recentForm edge 1',
  edgeOf(baseFighter({ recent: { fights: 5, winPct: 100 } }), baseFighter({ recent: { fights: 5, winPct: 0 } })).edges.recentForm, 1);
checkClose('0-5 vs 5-0 -> recentForm edge -1',
  edgeOf(baseFighter({ recent: { fights: 5, winPct: 0 } }), baseFighter({ recent: { fights: 5, winPct: 100 } })).edges.recentForm, -1);
checkClose('equal form -> 0',
  edgeOf(baseFighter({ recent: { fights: 5, winPct: 60 } }), baseFighter({ recent: { fights: 5, winPct: 60 } })).edges.recentForm, 0);
checkClose('thin data both sides -> 0',
  edgeOf(baseFighter({ recent: { fights: 2, winPct: 100 } }), baseFighter({ recent: { fights: 2, winPct: 100 } })).edges.recentForm, 0);

// ---------- (d) trajectory blends 70/30 with winPct ----------
const trajA = baseFighter({ recent: { fights: 5, winPct: 60 }, deep: { kdRate: 0.5, ctrlDiffSec: 10, roundWinPct: 0.6, trajectory: 0.4, fights: 3 } });
const trajB = baseFighter({ recent: { fights: 5, winPct: 60 }, deep: { kdRate: 0.5, ctrlDiffSec: 10, roundWinPct: 0.6, trajectory: -0.4, fights: 3 } });
checkClose('trajectory-only recentForm edge = 0.3 * 0.8',
  edgeOf(trajA, trajB).edges.recentForm, 0.24);

// ---------- (e) form moves the sim number (5-0 vs 0-5, all else equal) ----------
const r = runUFCMultiStatSimulation(
  baseFighter({ recent: { fights: 5, winPct: 100 } }),
  baseFighter({ recent: { fights: 5, winPct: 0 } }), 20000, 3, null);
checkBetween('5-0 form vs 0-5 form wins clearly post-shrinkage (3% weight)', r.winPctA, 50, 54);
check('no tiebreak hijack on a real edge', r.tiebreak, null);

if (fails) { console.log(fails + ' tests failed'); process.exit(1); }
console.log('all ufc form factor tests passed');
