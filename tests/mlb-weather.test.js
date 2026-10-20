// MLB weather: run-scoring factor math + compass helpers + lambda wiring.
// Tests the REAL bundle functions by extracting them from ../src/index.js
// (never a copy). Runs under plain node, no dependencies.
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

for (const v of ['var FOOTBALL_WIND_15_FACTOR', 'var FOOTBALL_WIND_20_FACTOR', 'var SOS_POINTS_TO_FACTOR', 'var TURNOVER_LUCK_DAMPEN', 'var POINTS_PER_TURNOVER']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['circularMeanDeg', 'windDirToCompass', 'mlbWeatherRunFactor', 'calculateLambdaMultiplier']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}

// --- Compass helpers ---
check('0 deg => N', windDirToCompass(0), 'N');
check('90 deg => E', windDirToCompass(90), 'E');
check('180 deg => S', windDirToCompass(180), 'S');
check('225 deg => SW', windDirToCompass(225), 'SW');
check('360 wraps => N', windDirToCompass(360), 'N');
check('null => null', windDirToCompass(null), null);
check('circular mean across N wrap (350,10) ~= 0', Math.round(circularMeanDeg([350, 10])), 0);
check('circular mean (90,270) degenerate => 0', circularMeanDeg([90, 270]), 0);

// --- MLB weather run factor ---
check('no data => neutral', mlbWeatherRunFactor({}).factor, 1);
check('mild day => neutral', mlbWeatherRunFactor({ tempF: 72, windMph: 8, precipPct: 10 }).factor, 1);
check('90F+ heat => 1.02', mlbWeatherRunFactor({ tempF: 93 }).factor, 1.02);
check('80-89F => 1.01', mlbWeatherRunFactor({ tempF: 85 }).factor, 1.01);
check('<=40F cold => 0.99', mlbWeatherRunFactor({ tempF: 38 }).factor, 0.99);
check('25mph+ wind => 1.015', mlbWeatherRunFactor({ tempF: 72, windMph: 26 }).factor, 1.015);
check('15-24mph wind => 1.005', mlbWeatherRunFactor({ tempF: 72, windMph: 18 }).factor, 1.005);
check('70%+ rain => 0.99', mlbWeatherRunFactor({ tempF: 72, precipPct: 80 }).factor, 0.99);
check('50% rain does NOT trigger', mlbWeatherRunFactor({ tempF: 72, precipPct: 50 }).factor, 1);
check('heat+wind+rain stack', mlbWeatherRunFactor({ tempF: 95, windMph: 30, precipPct: 80 }).factor, 1.0249);
check('clamped at 1.03 (1.02*1.015=1.0353)', mlbWeatherRunFactor({ tempF: 95, windMph: 30 }).factor, 1.03);
check('null temp skipped gracefully', mlbWeatherRunFactor({ tempF: null, windMph: 10 }).factor, 1);
check('note names the heat', mlbWeatherRunFactor({ tempF: 93 }).note.includes('93F'), true);

// --- Lambda wiring: baseballFactor flows, defaults neutral ---
const base = calculateLambdaMultiplier({});
check('default lambda multiplier is 1', base, 1);
check('baseballFactor 1.02 scales lambda', calculateLambdaMultiplier({ baseballFactor: 1.02 }), 1.02);
check('baseballFactor clamps at 1.1', calculateLambdaMultiplier({ baseballFactor: 9 }), 1.1);
check('baseballFactor composes with football weather path untouched',
  calculateLambdaMultiplier({ windMph: 20, baseballFactor: 1.01 }),
  Math.round(0.97 * 1.01 * 10000) / 10000);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('All MLB weather tests passed.');
