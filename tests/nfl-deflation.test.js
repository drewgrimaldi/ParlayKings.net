// NFL confidence deflation REMOVED (2026-11-23, Drew's order). The
// 5-point down-only shave added 2026-10-18 — after the calibration
// review flagged trailing-30d NFL picks at .406 against a .547 average
// stated confidence — is gone: NFL published confidence now logs
// exactly as band-calibrated, like every other league. This file
// guards the removal: if the deflation ever reappears in the source,
// this test fails.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.log('FAIL:', name); } };
check('deflation function is gone', !src.includes('applyNflConfidenceDeflation'));
check('deflation constant is gone', !src.includes('NFL_CONFIDENCE_DEFLATION_PTS'));
check('no deflation call site remains', !src.includes('preDeflation'));
check('band calibration still wired', src.includes('applyBandCalibration(rawConfidence, finalCalibrationParams)'));
check('80+ band cap still wired after calibration',
  src.includes('applyTopBandConfidenceCap(preCap)') &&
  src.indexOf('applyTopBandConfidenceCap(preCap)') > src.indexOf('applyBandCalibration(rawConfidence, finalCalibrationParams)'));
console.log(`nfl-deflation-removed: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
