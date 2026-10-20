// Audit wiring activations (2026-09-23): UFC fallback merge, UFC stance neutral,
// NFL/CFB cold-weather temp, golf season-split preference, bowling recency blend.
// Tests the REAL bundle functions by extracting them from ../src/index.js (never a copy).
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
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*[^;]+;'));
  if (!m) throw new Error('var missing from bundle: ' + name);
  return m[0];
}

// calculateLambdaMultiplier needs its module-level tunables in scope.
eval(extractVar('FOOTBALL_WIND_15_FACTOR'));
eval(extractVar('FOOTBALL_WIND_20_FACTOR'));
eval(extractVar('SOS_POINTS_TO_FACTOR'));
eval(extractVar('TURNOVER_LUCK_DAMPEN'));
eval(extractVar('POINTS_PER_TURNOVER'));

for (const fn of ['mergeUfcFallbackStats', 'ufcStanceType', 'calculateLambdaMultiplier', 'pickGolfScoringSplit', 'blendBowlingSeasonAvgs', 'blendSoccerVenueSplits']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' | got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}
function checkClose(desc, actual, expected, eps) {
  const ok = Math.abs(actual - expected) <= eps;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' | got=' + actual + ' want~' + expected);
}

// ---------- UFC fallback merge: real fetched fields survive ----------
const espnThin = { name: 'Fighter A', sapm: null, strikeDefense: null, takedownDefense: null, finishMix: null, country: null, strikeLPM: 4.0 };
const fb = { sapm: 3.8, strikeDefense: 0.61, takedownDefense: 0.72, finishMix: { ko: 5 }, country: 'USA', strikeLPM: 5.1 };
const merged = mergeUfcFallbackStats(espnThin, fb);
check('merge keeps fallback sapm', merged.sapm, 3.8);
check('merge keeps fallback strikeDefense', merged.strikeDefense, 0.61);
check('merge keeps fallback takedownDefense', merged.takedownDefense, 0.72);
check('merge keeps fallback finishMix', JSON.stringify(merged.finishMix), JSON.stringify({ ko: 5 }));
check('merge keeps fallback country', merged.country, 'USA');
check('merge keeps ESPN value when present', mergeUfcFallbackStats({ ...espnThin, sapm: 4.2 }, fb).sapm, 4.2);
check('merge with null fallback returns espn object', mergeUfcFallbackStats(espnThin, null), espnThin);

// ---------- UFC stance: unknown is neutral, never manufactured ----------
check('ufcStanceType(null) is null (not orthodox)', ufcStanceType(null), null);
check('ufcStanceType(undefined) is null', ufcStanceType(undefined), null);
check('ufcStanceType("") is null', ufcStanceType(''), null);
check('known southpaw still detected', ufcStanceType('Southpaw'), 'southpaw');
check('known orthodox still detected', ufcStanceType('Orthodox'), 'orthodox');
check('known switch still detected', ufcStanceType('Switch'), 'switch');
// The sim's edge logic is === comparisons: null can never equal "orthodox",
// so unknown-vs-southpaw now yields stanceEdge 0 instead of a phantom -0.025.
const stanceEdge = (a, b) => {
  const sa = ufcStanceType(a), sb = ufcStanceType(b);
  if (sa === 'southpaw' && sb === 'orthodox') return 0.025;
  if (sa === 'orthodox' && sb === 'southpaw') return -0.025;
  return 0;
};
check('unknown vs southpaw: no manufactured edge', stanceEdge(null, 'Southpaw'), 0);
check('unknown vs unknown: neutral', stanceEdge(null, null), 0);
check('real southpaw vs orthodox edge intact', stanceEdge('Southpaw', 'Orthodox'), 0.025);

// ---------- NFL/CFB temp: cold drag, symmetric, conservative ----------
checkClose('tempF null -> neutral', calculateLambdaMultiplier({ tempF: null }), 1, 1e-12);
checkClose('tempF 70 -> neutral (no heat drag for football)', calculateLambdaMultiplier({ tempF: 70 }), 1, 1e-12);
checkClose('tempF 33 -> neutral (above freezing)', calculateLambdaMultiplier({ tempF: 33 }), 1, 1e-12);
checkClose('tempF 32 -> 0.99 cold haircut', calculateLambdaMultiplier({ tempF: 32 }), 0.99, 1e-12);
checkClose('tempF 25 -> 0.99 cold haircut', calculateLambdaMultiplier({ tempF: 25 }), 0.99, 1e-12);
checkClose('tempF 20 -> 0.985 hard-cold haircut', calculateLambdaMultiplier({ tempF: 20 }), 0.985, 1e-12);
checkClose('tempF 10 -> 0.985 hard-cold haircut', calculateLambdaMultiplier({ tempF: 10 }), 0.985, 1e-12);
checkClose('cold stacks with wind tier honestly', calculateLambdaMultiplier({ tempF: 15, windMph: 22 }), 0.97 * 0.985, 1e-12);
checkClose('tempF NaN -> neutral', calculateLambdaMultiplier({ tempF: NaN }), 1, 1e-12);

// ---------- golf: prefer current-season split ----------
const YR = String(new Date().getFullYear());
const splits = [
  { displayName: 'Career', stats: ['71.2', 'x'] },
  { displayName: YR + ' Regular Season', stats: ['70.1', 'x'] },
  { displayName: 'Postseason', stats: ['69.9', 'x'] },
];
check('golf prefers current-year split', pickGolfScoringSplit(splits, 0).displayName, YR + ' Regular Season');
check('golf skips career split when unlabeled current exists',
  pickGolfScoringSplit([{ displayName: 'Career', stats: ['71.2', 'x'] }, { displayName: 'Season Stats', stats: ['70.1', 'x'] }], 0).displayName, 'Season Stats');
check('golf falls back to first usable when nothing labeled',
  pickGolfScoringSplit([{ displayName: 'Career', stats: ['71.2', 'x'] }], 0).displayName, 'Career');
check('golf returns null when no usable split', pickGolfScoringSplit([{ displayName: 'Career', stats: [] }], 0), null);

// ---------- bowling: 60/30/10 recency blend ----------
const oneRow = '| 2026 | a | b | c | d | e | 225.50 |';
checkClose('bowling single row = that avg', blendBowlingSeasonAvgs(oneRow).avg, 225.5, 1e-9);
const threeRows = '| 2024 | a | b | c | d | e | 220.00 |\n| 2026 | a | b | c | d | e | 230.00 |\n| 2025 | a | b | c | d | e | 225.00 |';
checkClose('bowling 3-row 60/30/10 blend', blendBowlingSeasonAvgs(threeRows).avg, 230 * 0.6 + 225 * 0.3 + 220 * 0.1, 1e-9);
check('bowling no rows -> null', blendBowlingSeasonAvgs('no data here'), null);
check('bowling filters insane avgs', blendBowlingSeasonAvgs('| 2026 | a | b | c | d | e | 999.00 |'), null);

// ---------- soccer venue splits: 50/50 TOTAL-anchored, fail-open ----------
const socA = { offense: 2.0, defense: 1.0, offenseHome: 2.6, defenseHome: 0.8, offenseAway: 1.4, defenseAway: 1.2 };
const socB = { offense: 1.5, defense: 1.5, offenseHome: 2.0, defenseHome: 1.0, offenseAway: 1.0, defenseAway: 2.0 };
check('soccer blend applies when splits present', blendSoccerVenueSplits({ ...socA }, { ...socB }, true), true);
{
  const a = { ...socA }, b = { ...socB };
  blendSoccerVenueSplits(a, b, true);
  checkClose('soccer home side gets HOME blend', a.offense, 0.5 * 2.0 + 0.5 * 2.6, 1e-9);
  checkClose('soccer home side defense gets HOME blend', a.defense, 0.5 * 1.0 + 0.5 * 0.8, 1e-9);
  checkClose('soccer away side gets AWAY blend', b.offense, 0.5 * 1.5 + 0.5 * 1.0, 1e-9);
  checkClose('soccer away side defense gets AWAY blend', b.defense, 0.5 * 1.5 + 0.5 * 2.0, 1e-9);
}
{
  // homeTeamIsA false: A is the AWAY side and gets away-table rates.
  const a = { ...socA }, b = { ...socB };
  blendSoccerVenueSplits(a, b, false);
  checkClose('soccer A-as-away uses AWAY rates', a.offense, 0.5 * 2.0 + 0.5 * 1.4, 1e-9);
  checkClose('soccer B-as-home uses HOME rates', b.offense, 0.5 * 1.5 + 0.5 * 2.0, 1e-9);
}
{
  // Fallback paths (BALLDONTLIE/ESPN) carry no splits -> fail open to TOTAL.
  const a = { offense: 2.0, defense: 1.0 }, b = { offense: 1.5, defense: 1.5 };
  check('soccer no splits: nothing blended', blendSoccerVenueSplits(a, b, true), false);
  check('soccer no splits: offense untouched', a.offense, 2.0);
  check('soccer no splits: defense untouched', a.defense, 1.0);
}
{
  // Partial splits: only the present side blends.
  const a = { offense: 2.0, defense: 1.0, offenseHome: 2.6, defenseHome: null, offenseAway: null, defenseAway: null };
  const b = { offense: 1.5, defense: 1.5 };
  blendSoccerVenueSplits(a, b, true);
  checkClose('soccer partial: present home offense blends', a.offense, 0.5 * 2.0 + 0.5 * 2.6, 1e-9);
  check('soccer partial: missing home defense untouched', a.defense, 1.0);
  check('soccer partial: B untouched', b.offense, 1.5);
}

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('ALL WIRING-AUDIT TESTS PASS');
