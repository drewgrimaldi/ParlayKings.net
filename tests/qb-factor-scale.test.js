// NFL/CFB QB key-player factor scale fix (Drew's call 2026-09-23).
// ESPN's athlete-overview "QBRating" is a DIFFERENT stat per league (verified live):
//   NFL = classic passer rating (avg ~90, 0-158.3 scale)
//   CFB = NCAA passer efficiency (avg ~135, ~100-200+ scale; same as NCAA.com "Pass Eff" fallback)
// The old code ran both through (90, 150), so an average college QB maxed the
// 1.25 clamp. Tests the REAL bundle functions extracted from ../src/index.js
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

for (const fn of ['qbScaleForLeague', 'qbFactorFromValue']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}
const r4 = (v) => Math.round(v * 10000) / 10000;
const f = (stat, key) => {
  const s = qbScaleForLeague(key);
  return r4(qbFactorFromValue(stat, s.leagueAvg, s.scaleDivisor));
};

// --- Scale selection ---
check('NFL scale', qbScaleForLeague('NFL'), { leagueAvg: 90, scaleDivisor: 150, statLabel: 'QB Rating' });
check('CFB scale', qbScaleForLeague('CFB'), { leagueAvg: 135, scaleDivisor: 225, statLabel: 'Pass Eff' });

// --- NFL: classic passer rating, live-verified values ---
check('NFL elite (Allen 125.8) near top, not maxed', f(125.8, 'NFL'), 1.2387);
check('NFL avg (90) neutral', f(90, 'NFL'), 1);
check('NFL below avg (65) dips, not floored', f(65, 'NFL'), 0.8333);
check('NFL terrible (50) clamps at floor', f(50, 'NFL'), 0.8);

// --- CFB: NCAA passer efficiency, live-verified values ---
check('CFB elite (Sayin 182.4) boosts, not maxed', f(182.4, 'CFB'), 1.2107);
check('CFB average (135) neutral — NOT 1.25 (the old bug)', f(135, 'CFB'), 1);
check('CFB below avg (115) dips', f(115, 'CFB'), 0.9111);
check('CFB bad (95) dips, not floored', f(95, 'CFB'), 0.8222);
check('CFB terrible (70) clamps at floor', f(70, 'CFB'), 0.8);

// --- Regression: the old single-scale math maxed average college QBs ---
check('OLD params on CFB avg QB (135, 90, 150) maxed at 1.25 — bug demonstrated', r4(qbFactorFromValue(135, 90, 150)), 1.25);

// --- Monotonicity: better QB always means a bigger factor ---
check('CFB monotonic: 182.4 > 160 > 135 > 115',
  f(182.4, 'CFB') > f(160, 'CFB') && f(160, 'CFB') > f(135, 'CFB') && f(135, 'CFB') > f(115, 'CFB'), true);
check('NFL monotonic: 125.8 > 100 > 90 > 65',
  f(125.8, 'NFL') > f(100, 'NFL') && f(100, 'NFL') > f(90, 'NFL') && f(90, 'NFL') > f(65, 'NFL'), true);

// --- Drew's acceptance criteria ---
check('good CFB QB (160) never drags to floor', f(160, 'CFB') > 0.8, true);
check('good NFL QB (100) never drags to floor', f(100, 'NFL') > 0.8, true);
check('avg CFB QB never maxes', f(135, 'CFB') < 1.25, true);
check('avg NFL QB never maxes', f(90, 'NFL') < 1.25, true);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('qb-factor-scale: all checks passed');
