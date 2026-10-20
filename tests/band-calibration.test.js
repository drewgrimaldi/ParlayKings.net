// Band calibration (deflationary): fit on LOGGED confidence, down-only clamp,
// exact-50 preserved.
//
// Restored 2026-09-22 at Drew's call (reverts the 2026-09-21 redesign):
// - fitBandCalibration buckets on the already band-calibrated logged
//   "Confidence %", NOT on the raw sim picked-side %. Bands learn on their
//   own past outputs, which pulls published confidence down toward realized
//   hit rates and keeps marginal picks near the 50/50 Push line.
// - applyBandCalibration always returns a detail object (never a bare number),
//   leaves exact-50 untouched (the 50/50 rule owns it), and the correction
//   may only pull DOWN — never up (down-only clamp).
// Tests the REAL bundle functions by extracting them from ../src/index.js
// (never a copy), plus wiring guards. Runs under plain node, no dependencies.
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

for (const fn of ['fitBandCalibration', 'applyBandCalibration']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}
function rec(conf, result) {
  return { fields: { 'Confidence %': conf, 'Result': result } };
}

(function () {
  // Below the 20-graded minimum the fit returns null: calibration no-ops.
  const thin = [];
  for (let i = 0; i < 10; i++) thin.push(rec(0.55, 'Win'));
  for (let i = 0; i < 9; i++) thin.push(rec(0.62, 'Loss'));
  eq(fitBandCalibration(thin), null, 'fit returns null under 20 graded picks');
  const nullApply = applyBandCalibration(70, null);
  eq(typeof nullApply, 'object', 'apply with null params returns detail object (never a bare number)');
  eq(nullApply.pct, 70, 'apply with null params passes raw through');

  // Fit keys on the LOGGED confidence, not the raw sim: 100 picks logged at
  // 0.64 (regardless of sim split) land in the 60-69% band.
  const logged = [];
  for (let i = 0; i < 52; i++) logged.push(rec(0.64, 'Win'));
  for (let i = 0; i < 48; i++) logged.push(rec(0.64, 'Loss'));
  const params = fitBandCalibration(logged);
  eq(params !== null, true, 'fit returns params at n=100');
  eq(params.n, 100, 'fit reports total graded count');
  eq(params.buckets.map((b) => b.label).join(','), '50-59%,60-69%,70-79%,80-89%,90%+', 'buckets are the logged-confidence bands');
  const band6069 = params.buckets.find((b) => b.label === '60-69%');
  eq(band6069.wins + band6069.losses, 100, 'logged-0.64 picks bucketed by logged conf');

  // Overconfident 60-69% band (52% hit at logged ~0.64): a fresh 64 comes DOWN.
  const cal = applyBandCalibration(64, params);
  eq(cal.pct < 64, true, 'overconfident 60-69 band pulls 64 down (got ' + cal.pct + ')');
  eq(cal.bucketLabel, '60-69%', 'correction attributed to the right band');

  // Down-only clamp: even a HOT band (80% hit at logged ~0.55) may NOT pull
  // a fresh 55 up. Deflation only.
  const hot = [];
  for (let i = 0; i < 80; i++) hot.push(rec(0.55, 'Win'));
  for (let i = 0; i < 20; i++) hot.push(rec(0.55, 'Loss'));
  const hotParams = fitBandCalibration(hot);
  const noUp = applyBandCalibration(55, hotParams);
  eq(noUp.pct <= 55, true, 'hot band never pulls 55 UP (got ' + noUp.pct + ')');

  // Thin 80-89% band (1-1): shrinkage keeps it near raw instead of overfitting.
  const mixed = [];
  for (let i = 0; i < 14; i++) mixed.push(rec(0.55, 'Win'));
  for (let i = 0; i < 11; i++) mixed.push(rec(0.55, 'Loss'));
  mixed.push(rec(0.85, 'Win'));
  mixed.push(rec(0.85, 'Loss'));
  const mixedParams = fitBandCalibration(mixed);
  const thinCal = applyBandCalibration(85, mixedParams);
  eq(thinCal.pct <= 85, true, 'thin 80-89% band never inflates (got ' + thinCal.pct + ')');

  // Exact 50 is sacred: the 50/50 rule owns it (grades as Push).
  const fifty = applyBandCalibration(50, params);
  eq(fifty.pct, 50, 'exact-50 passes through untouched');

  // Wiring guards: the application block must be live and the down-only
  // clamp must be present in the bundle; the symmetric clamp bound is gone.
  eq(src.includes('applyBandCalibration(rawConfidence, finalCalibrationParams)'), true, 'application block calls apply on finalCalibrationParams');
  eq(src.includes('pct = Math.min(rawConfidencePct, pct);'), true, 'down-only clamp present in applyBandCalibration');
  eq(/var BAND_CALIBRATION_MAX_SHIFT_PTS/.test(src), false, 'symmetric clamp bound declaration is gone from the bundle');
  eq(/function biasLearnerPredictedPct/.test(src), false, 'raw-input bias learner helper is gone');
  eq(/^\s*void finalCalibrationParams;$/m.test(src), false, 'calibration kill-switch is gone');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
