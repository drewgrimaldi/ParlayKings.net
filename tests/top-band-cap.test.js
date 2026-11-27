// 80+ band confidence cap (2026-10-28): trailing-30d 80+ band went 12-8
// (60.0%) against an 83.0% average stated confidence. Published confidence
// at 80+ is capped at 79, all leagues, down-only, applied after band
// calibration and the NFL deflation.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.log('FAIL:', name); } };
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}
const constDecl = src.match(/const TOP_BAND_CONFIDENCE_CAP_PCT = \d+;/)[0];
const applyTopBandConfidenceCap = eval(constDecl + '\n(' + extractFn('applyTopBandConfidenceCap') + ')');
check('80 caps to 79', applyTopBandConfidenceCap(80) === 79);
check('85 caps to 79', applyTopBandConfidenceCap(85) === 79);
check('99 caps to 79', applyTopBandConfidenceCap(99) === 79);
check('79 stays 79', applyTopBandConfidenceCap(79) === 79);
check('75 unchanged', applyTopBandConfidenceCap(75) === 75);
check('51 unchanged', applyTopBandConfidenceCap(51) === 51);
check('exact 50 untouched (50/50 rule owns it)', applyTopBandConfidenceCap(50) === 50);
check('non-number passes through', applyTopBandConfidenceCap(null) === null && applyTopBandConfidenceCap(undefined) === undefined);
check('never raises a number', [51, 60, 79, 80, 90, 99].every((n) => applyTopBandConfidenceCap(n) <= n));
check('nothing below 80 ever moves', [1, 25, 49, 50, 51, 60, 70, 79].every((n) => applyTopBandConfidenceCap(n) === n));
check('wired after band calibration and NFL deflation in the prediction path',
  src.includes('applyTopBandConfidenceCap(preCap)') &&
  src.indexOf('applyTopBandConfidenceCap(preCap)') > src.indexOf('applyNflConfidenceDeflation(preDeflation)') &&
  src.indexOf('applyTopBandConfidenceCap(preCap)') > src.indexOf('applyBandCalibration(rawConfidence, finalCalibrationParams)'));
console.log(`top-band-cap: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
