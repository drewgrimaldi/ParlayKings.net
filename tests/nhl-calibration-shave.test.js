// NHL calibration shave (2026-11-23, Drew's order approving tonight's
// calibration brief): NHL ran -9.5 against its confidence Nov 9-22
// (n=63) after +0.5 Oct 24-Nov 8; the 70s band's 30-day gap is -20.0
// (n=26) and the 50s band leaked -10.7 over 14 days (n=28). NHL
// published confidence takes a down-only shave after band calibration:
// 5 points at 70%+, 3 points in the 50s band. 60s band untouched.
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
const constDecls = [
  src.match(/const NHL_CALIBRATION_SHAVE_70PLUS_PTS = \d+;/)[0],
  src.match(/const NHL_CALIBRATION_SHAVE_50S_PTS = \d+;/)[0]
].join('\n');
const applyNhlCalibrationShave = eval(constDecls + '\n(' + extractFn('applyNhlCalibrationShave') + ')');
// 70+ band: 5-point shave.
check('75 shaves to 70', applyNhlCalibrationShave(75) === 70);
check('70 shaves to 65', applyNhlCalibrationShave(70) === 65);
check('85 shaves to 80 (80+ cap applies after)', applyNhlCalibrationShave(85) === 80);
check('99 shaves to 94', applyNhlCalibrationShave(99) === 94);
// 60s band: untouched - no shave was approved for it.
check('69 unchanged', applyNhlCalibrationShave(69) === 69);
check('65 unchanged', applyNhlCalibrationShave(65) === 65);
check('60 unchanged', applyNhlCalibrationShave(60) === 60);
// 50s band: 3-point shave, floored at 51.
check('59 shaves to 56', applyNhlCalibrationShave(59) === 56);
check('55 shaves to 52', applyNhlCalibrationShave(55) === 52);
check('54 floors at 51', applyNhlCalibrationShave(54) === 51);
check('52 floors at 51', applyNhlCalibrationShave(52) === 51);
check('51 stays 51', applyNhlCalibrationShave(51) === 51);
// Exact 50 is sacred: the 50/50 rule owns it.
check('exact 50 untouched (50/50 rule owns it)', applyNhlCalibrationShave(50) === 50);
check('non-number passes through', applyNhlCalibrationShave(null) === null && applyNhlCalibrationShave(undefined) === undefined);
check('never raises a number', [51, 55, 59, 60, 69, 70, 80, 99].every((n) => applyNhlCalibrationShave(n) <= n));
// Wiring: NHL picks only, after band calibration, before the 80+ cap.
check('wired for NHL picks only',
  src.includes('normalizeLeague(pick.league) === "NHL"') &&
  src.includes('applyNhlCalibrationShave(preShave)'));
check('wired after band calibration',
  src.indexOf('applyNhlCalibrationShave(preShave)') > src.indexOf('applyBandCalibration(rawConfidence, finalCalibrationParams)'));
check('wired before the 80+ band cap',
  src.indexOf('applyNhlCalibrationShave(preShave)') < src.indexOf('applyTopBandConfidenceCap(preCap)'));
console.log(`nhl-calibration-shave: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
