// NFL confidence deflation (2026-10-18): trailing-30d NFL picks hit .406
// against a .547 average stated confidence - the first league leak the
// calibration review flagged in seven weeks. NFL published confidence
// takes an extra 5-point down-only shave after band calibration.
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
const constDecl = src.match(/const NFL_CONFIDENCE_DEFLATION_PTS = \d+;/)[0];
const applyNflConfidenceDeflation = eval(constDecl + '\n(' + extractFn('applyNflConfidenceDeflation') + ')');
check('65 deflates to 60', applyNflConfidenceDeflation(65) === 60);
check('58 deflates to 53', applyNflConfidenceDeflation(58) === 53);
check('56 floors at 51', applyNflConfidenceDeflation(56) === 51);
check('54 floors at 51', applyNflConfidenceDeflation(54) === 51);
check('51 stays 51', applyNflConfidenceDeflation(51) === 51);
check('exact 50 untouched (50/50 rule owns it)', applyNflConfidenceDeflation(50) === 50);
check('non-number passes through', applyNflConfidenceDeflation(null) === null && applyNflConfidenceDeflation(undefined) === undefined);
check('never raises a number', [52, 60, 75, 90, 99].every((n) => applyNflConfidenceDeflation(n) <= n));
check('wired after band calibration for NFL picks only',
  src.includes('applyNflConfidenceDeflation(preDeflation)') &&
  src.indexOf('applyNflConfidenceDeflation(preDeflation)') > src.indexOf('applyBandCalibration(rawConfidence, finalCalibrationParams)'));
console.log(`nfl-deflation: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
