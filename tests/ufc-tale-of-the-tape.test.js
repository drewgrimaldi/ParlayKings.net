// UFC tale of the tape on top (Drew's call 2026-09-23): the physical tape and
// striking/grappling stat differentials (reach, height, age, stance, SLpM,
// accuracy, SApM, takedowns, subs, defenses) are the top tier of the UFC model.
// Everything below them was demoted: ufcFinishMixScale compressed from
// clamp(0.72 + share*0.9, 0.78, 1.32) to clamp(0.90 + share*0.35, 0.90, 1.10),
// the weight-class finish-bias table compressed halfway toward 1.0, and the
// home-country strike boost halved from +0.03 to +0.015. Tests the REAL bundle
// code by extracting from ../src/index.js (never a copy).
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
  '__name222222222','__name2222222222','__name22222222222']) {
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

// ---- (b) finish-mix max swing is ~±10%, not ±25%+ ----
checkClose('mix share 1 -> 1.10 (was 1.32)', ufcFinishMixScale({ koShare: 1 }, 'koShare'), 1.10);
checkClose('mix share 0 -> 0.90 (was 0.78)', ufcFinishMixScale({ koShare: 0 }, 'koShare'), 0.90);
checkClose('mix share 0.5 -> 1.075', ufcFinishMixScale({ koShare: 0.5 }, 'koShare'), 1.075);
check('mix missing -> 1', ufcFinishMixScale(null, 'koShare'), 1);
checkClose('subShare share 1 -> 1.10', ufcFinishMixScale({ subShare: 1 }, 'subShare'), 1.10);

// ---- weight-class finish-bias table compressed halfway toward 1.0 ----
checkClose('heavyweight ko 1.09 (was 1.18)', ufcWeightClassFinishBias('Heavyweight').ko, 1.09);
checkClose('heavyweight sub 0.96 (was 0.92)', ufcWeightClassFinishBias('Heavyweight').sub, 0.96);
checkClose('flyweight ko 0.91 (was 0.82)', ufcWeightClassFinishBias('Flyweight').ko, 0.91);
checkClose('flyweight sub 1.05 (was 1.10)', ufcWeightClassFinishBias('Flyweight').sub, 1.05);
checkClose('bantamweight ko 0.94 (was 0.88)', ufcWeightClassFinishBias('Bantamweight').ko, 0.94);
checkClose('welterweight ko 1.00 (was 1)', ufcWeightClassFinishBias('Welterweight').ko, 1.00);
checkClose("women's strawweight ko 0.91 (prefix stripped)", ufcWeightClassFinishBias("Women's Strawweight").ko, 0.91);
check('unknown class -> neutral', ufcWeightClassFinishBias('Superheavyweight').ko, 1);

// ---- (c) form is now the 10% Recent Performance / Trajectory factor ----
// (Drew's 2026-09-24 call; the old 0.98-1.02 volume multiplier is gone.)
const formFactor = UFC_IMPORTANCE_WEIGHTS.find((f) => f.key === 'recentForm');
check('recentForm weight is 3% (Drew 2026-10-05)', formFactor && formFactor.weight, 0.03);

// ---- (a) tape advantage beats KO-share advantage, all else equal ----
// Fighter A: clear tape (4"+ reach, better accuracy/defense) but weak KO history.
// Fighter B: monster KO history (100% KO share) but worse tape, tiny reach.
const statsA = {
  strikeLPM: 5.2, strikeAccuracy: 52, sapm: 3.1,
  takedownAvg: 1.4, takedownAccuracy: 45, submissionAvg: 0.4,
  strikeDefense: 62, takedownDefense: 72,
  reach: '76"', height: "6' 1\"", stance: 'Orthodox', age: 29,
  weightClass: 'Middleweight', country: 'USA',
  finishMix: { koShare: 0.2, subShare: 0.2 },
  recent: { fights: 5, winPct: 60 }
};
const statsB = {
  strikeLPM: 3.6, strikeAccuracy: 44, sapm: 4.9,
  takedownAvg: 0.8, takedownAccuracy: 35, submissionAvg: 0.2,
  strikeDefense: 48, takedownDefense: 55,
  reach: '71"', height: "6' 0\"", stance: 'Orthodox', age: 29,
  weightClass: 'Middleweight', country: 'Canada',
  finishMix: { koShare: 1.0, subShare: 0.0 },
  recent: { fights: 5, winPct: 60 }
};
// Same country for neither (eventCountry null) so home boost is 0; equal form.
const r = runUFCMultiStatSimulation(statsA, statsB, 8000, 3, null);
checkGt('tape-dominant fighter wins sim despite 100% KO history on the other side', r.winPctA, 55);
checkLt('shrunk split stays sane', r.winPctA, 95);

// Same matchup but swap the KO shares: B's edge should shrink the gap only a little.
const statsBweak = Object.assign({}, statsB, { finishMix: { koShare: 0.1, subShare: 0.1 } });
const r2 = runUFCMultiStatSimulation(statsA, statsBweak, 8000, 3, null);
checkGt('even with weak KO history, tape still wins', r2.winPctA, 55);
checkLt('demoted finish mix cannot flip the tape advantage (|diff| small)', Math.abs(r.winPctA - r2.winPctA), 8);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
process.exit(fails ? 1 : 0);
