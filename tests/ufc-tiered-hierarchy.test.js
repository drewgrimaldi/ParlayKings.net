// UFC 15-factor importance weights (Drew's call 2026-09-24):
// the 2026-09-23 tiered hierarchy (TIER 1 striking trio + grappling at full
// strength, TIER 2 physicals, TIER 3 everything else) is SUPERSEDED. The Monte
// Carlo loop is now driven by Drew's 15 importance weights — one composite edge
// E computed once per matchup, banked per round as E * UFC_ROUND_EDGE_SCALE.
// The old mechanistic round scoring (strike/control volume accumulation, the
// 1.15 takedown control credit, the *0.22/x2.4 strike-differential kicker, the
// form volume multiplier) is gone. KO/sub/TD event rolls keep their math.
// Untouched: 0.40 shrinkage, down-only calibration, 50/50 rule + caps.
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

// ---------- (a) the weights table: 15 factors, 100%, Drew's top-5 = 59% ----------
check('15 importance weights', UFC_IMPORTANCE_WEIGHTS.length, 15);
checkClose('weights sum to 100%', UFC_IMPORTANCE_WEIGHTS.reduce((s, f) => s + f.weight, 0), 1.00);
checkClose('top-5 emphasized inputs carry 58% (Drew 2026-10-05)',
  UFC_IMPORTANCE_WEIGHTS.slice(0, 5).reduce((s, f) => s + f.weight, 0), 0.58);
check('factor #1 is Significant Strike Differential at 15%',
  UFC_IMPORTANCE_WEIGHTS[0].key === 'strikeDiff' && UFC_IMPORTANCE_WEIGHTS[0].weight === 0.15, true);
check('round edge scale is 0.75', UFC_ROUND_EDGE_SCALE, 0.75);
check('shrinkage is 0.40', CONSERVATISM_SHRINKAGE, 0.40);

// ---------- (b) the sim runs on the composite, not the old mechanics ----------
check('round scoring banks compositeEdge * UFC_ROUND_EDGE_SCALE',
  simSrc.includes('compositeEdge * UFC_ROUND_EDGE_SCALE'), true);
check('composite computed once per matchup', simSrc.includes('ufcWeightedCompositeEdge(statsA, statsB, eventCountry)'), true);
check('old strike-differential kicker gone', simSrc.includes('strikeDiffEdgeA'), false);
check('old takedown control credit gone', simSrc.includes('controlA = 1.15'), false);
check('old form multiplier gone', simSrc.includes('formA'), false);

// ---------- (c) event rolls keep their math (no double-count, no loss) ----------
check('takedown probability multiplier still 2.2', simSrc.includes('tdAccA01 * 2.2 *') && simSrc.includes('tdAccB01 * 2.2 *'), true);
check('sub-finish coefficient still 0.08', simSrc.includes('subA * 0.08 * mixSubA') && simSrc.includes('subB * 0.08 * mixSubB'), true);
check('KO chance still scales on landed strikes x 0.035', simSrc.includes('strikeA * 0.035 *') && simSrc.includes('strikeB * 0.035 *'), true);

// ---------- (d) physicals are capped at +/-0.10 on the composite ----------
function baseFighter(over) {
  return Object.assign({
    strikeLPM: 4.5, strikeAccuracy: 46, takedownAvg: 1.2, takedownAccuracy: 40,
    submissionAvg: 0.3, sapm: 4.0, strikeDefense: 54, takedownDefense: 60,
    reach: 72, height: 70, stance: 'orthodox', age: 29,
    weightClass: 'Lightweight', country: 'United States', finishMix: null,
    recent: null, deep: null
  }, over);
}
const physOnly = ufcWeightedCompositeEdge(
  baseFighter({ reach: 80, height: 76, stance: 'southpaw', age: 22 }),
  baseFighter({ reach: 68, height: 66, stance: 'orthodox', age: 38 }), 'United States');
check('extreme physicals capped at +/-0.10 on the composite', Math.abs(physOnly.E) <= 0.1001, true);

// ---------- (e) behavioral: symmetric 50/50, edges move the number ----------
const sym = runUFCMultiStatSimulation(baseFighter(), baseFighter(), 20000, 3, null);
check('symmetric fighters -> 50/50', sym.winPctA, 50);
const striker = runUFCMultiStatSimulation(
  baseFighter({ strikeLPM: 6.5, sapm: 2.5, strikeDefense: 65 }),
  baseFighter({ strikeLPM: 3.0, sapm: 5.5, strikeDefense: 45 }), 20000, 3, null);
checkBetween('dominant striker wins clearly post-shrinkage', striker.winPctA, 60, 80);
const grappler = runUFCMultiStatSimulation(
  baseFighter({ takedownAvg: 3.5, takedownAccuracy: 60, takedownDefense: 80, submissionAvg: 0.9 }),
  baseFighter({ takedownAvg: 0.5, takedownAccuracy: 25, takedownDefense: 40, submissionAvg: 0.1 }), 20000, 3, null);
checkBetween('dominant grappler wins post-shrinkage', grappler.winPctA, 55, 66);

if (fails) { console.log(fails + ' tests failed'); process.exit(1); }
console.log('all ufc importance hierarchy tests passed');
