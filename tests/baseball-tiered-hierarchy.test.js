// BASEBALL TIERED HIERARCHY (Drew's call 2026-09-23): the sim weighs baseball
// inputs in a strict order. Tier order with max per-team swing:
//   T1  starting pitcher (ERA factor, the QB of baseball)   0.70-1.40
//   T2  bullpen (reliever anchor 3.90, blend 58/42 at lock)  0.80-1.25
//   T3  the bats (team runs scored — the engine, base lambda, unchanged)
//   T4  infielders sampled individually, Drew's order:
//         SS 0.88-1.12 > 1B 0.90-1.10 > 2B/3B 0.92-1.08 (OPS-driven)
//   T5  home field (+0.15), rest, weather, travel, form (unchanged, smallest)
// Uses the REAL bundle functions extracted from ../src/index.js (never a copy).

const src = require('fs').readFileSync(require('path').join(__dirname, '../src/index.js'), 'utf8');
function extractConst(name) {
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('const not found: ' + name);
  return eval('(' + m[1] + ')');
}
function extract(name, extra = {}) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error('fn not found: ' + name);
  let i = m.index + m[0].length, pdepth = 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') pdepth++;
    if (src[i] === ')') { pdepth--; if (!pdepth) break; }
  }
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; if (src[j] === '}') { depth--; if (!depth) break; } }
  const g = Object.assign({ __name: (f) => f }, extra);
  for (let k = 1; k <= 11; k++) g['__name' + '2'.repeat(k)] = (f) => f;
  const names = Object.keys(g);
  return new Function(names.join(','), src.slice(m.index, j + 1) + '\nreturn ' + name + ';')(...names.map((n) => g[n]));
}
const SOS_POINTS_TO_FACTOR = extractConst('SOS_POINTS_TO_FACTOR');
const TURNOVER_LUCK_DAMPEN = extractConst('TURNOVER_LUCK_DAMPEN');
const POINTS_PER_TURNOVER = extractConst('POINTS_PER_TURNOVER');
const FOOTBALL_WIND_20_FACTOR = extractConst('FOOTBALL_WIND_20_FACTOR');
const FOOTBALL_WIND_15_FACTOR = extractConst('FOOTBALL_WIND_15_FACTOR');
const CONSERVATISM_SHRINKAGE = extractConst('CONSERVATISM_SHRINKAGE');
const SCORING_MODEL = extractConst('SCORING_MODEL');
const LEAGUE_AVERAGE_FALLBACKS = extractConst('LEAGUE_AVERAGE_FALLBACKS');
const FOOTBALL_SCORE_BOUNDS = extractConst('FOOTBALL_SCORE_BOUNDS');
const normalizeLeague = extract('normalizeLeague');
const pitcherSampleWeight = extract('pitcherSampleWeight');
const pitcherERAToFactor = extract('pitcherERAToFactor', { pitcherSampleWeight });
const bullpenEraToFactor = extract('bullpenEraToFactor');
const blendMlbPitchingFactors = extract('blendMlbPitchingFactors');
const opsFromMlbBatting = extract('opsFromMlbBatting');
const mlbInfielderFactorFromOps = extract('mlbInfielderFactorFromOps');
const calculateLambdaMultiplier = extract('calculateLambdaMultiplier', {
  SOS_POINTS_TO_FACTOR, TURNOVER_LUCK_DAMPEN, POINTS_PER_TURNOVER,
  FOOTBALL_WIND_20_FACTOR, FOOTBALL_WIND_15_FACTOR
});
const isFootballLeague = extract('isFootballLeague', { normalizeLeague });
const footballBounds = extract('footballBounds', { normalizeLeague, FOOTBALL_SCORE_BOUNDS });
const clampFootballLambda = extract('clampFootballLambda', { footballBounds, normalizeLeague });
const clampFootballScore = extract('clampFootballScore', { footballBounds });
const sampleNormal = extract('sampleNormal');
const samplePoisson = extract('samplePoisson', { sampleNormal });
const sampleBivariatePoisson = extract('sampleBivariatePoisson', { samplePoisson });
const bridgeToTeamSim = extract('bridgeToTeamSim', {
  LEAGUE_AVERAGE_FALLBACKS, isFootballLeague, clampFootballLambda,
  calculateLambdaMultiplier, footballBounds
});
const runTeamSportSimulation = extract('runTeamSportSimulation', {
  SCORING_MODEL, bridgeToTeamSim, sampleBivariatePoisson, sampleNormal,
  isFootballLeague, clampFootballScore, CONSERVATISM_SHRINKAGE
});

let fails = 0;
function check(name, actual, expected) {
  if (actual !== expected) { fails++; console.error('FAIL ' + name + ': got ' + actual + ', want ' + expected); }
}
function checkClose(name, actual, expected, tol = 1e-9) {
  if (Math.abs(actual - expected) > tol) { fails++; console.error('FAIL ' + name + ': got ' + actual + ', want ~' + expected); }
}
function checkTrue(name, cond) {
  if (!cond) { fails++; console.error('FAIL ' + name); }
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = real; }
}

// ---------- TIER 1: the starter is the single dominant weight ----------
// Elite ace, full sample (200 IP / 30 GS -> w=1): 2.20/4.20 = 0.5238 -> 0.70.
checkClose('elite ace ERA 2.20 hits 0.70 floor', pitcherERAToFactor(2.20, 200, 30), 0.70, 1e-12);
// No longer flattened at the old 0.86 — the ace moves the number for real.
checkTrue('ace below old 0.86 flattening', pitcherERAToFactor(2.20, 200, 30) < 0.86);
// Batting-practice arm, full sample: 6.50/4.20 = 1.5476 -> 1.40.
checkClose('bad starter ERA 6.50 hits 1.40 ceiling', pitcherERAToFactor(6.50, 200, 30), 1.40, 1e-12);
// Average arm is neutral.
checkClose('average ERA 4.20 -> 1.0', pitcherERAToFactor(4.20, 200, 30), 1.0, 1e-12);
// Thin sample stays neutral (gate untouched): 10 IP / 2 GS -> w=0.2 < 0.25.
checkClose('thin sample neutral', pitcherERAToFactor(2.20, 10, 2), 1, 1e-12);
// Invalid ERAs neutral.
check('ERA 0 neutral', pitcherERAToFactor(0, 200, 30), 1);
check('ERA 13 neutral', pitcherERAToFactor(13, 200, 30), 1);
// Regression toward 4.2 still works mid-range: ERA 3.00 full sample -> 3/4.2.
checkClose('ERA 3.00 regressed', pitcherERAToFactor(3.00, 200, 30), 3.0 / 4.2, 1e-12);

// ---------- TIER 2: bullpen anchor fix ----------
// Elite pen 2.80: 2.8/3.9 = 0.7179 -> tier-2 floor 0.80 (was flattened to 0.86
// against the 4.2 starter anchor: 2.8/4.2 = 0.667 -> 0.86).
checkClose('elite pen 2.80 -> 0.80', bullpenEraToFactor(2.80), 0.80, 1e-12);
checkTrue('elite pen now beats old 0.86 flattening', bullpenEraToFactor(2.80) < 0.86);
// Average pen is neutral against its own anchor.
checkClose('average pen 3.90 -> 1.0', bullpenEraToFactor(3.90), 1.0, 1e-12);
// Arson unit: 5.50/3.9 = 1.410 -> tier-2 ceiling 1.25.
checkClose('bad pen 5.50 -> 1.25', bullpenEraToFactor(5.50), 1.25, 1e-12);
check('invalid pen ERA neutral', bullpenEraToFactor(0), 1);
// Tier ladder: T1 max swing (1.40) > T2 max swing (1.25).
checkTrue('T1 ceiling above T2 ceiling', 1.40 > 1.25);

// ---------- Tier-2 blend rebalance ----------
// Full lock, true bullpen: 58/42 -> 0.70*0.58 + 0.80*0.42 = 0.742.
checkClose('blend 58/42 at full lock', blendMlbPitchingFactors(0.70, 1, 0.80, 'bullpen'), 0.742, 1e-12);
// Staff proxy: 75/25 -> 0.70*0.75 + 0.90*0.25 = 0.75.
checkClose('staff proxy 75/25', blendMlbPitchingFactors(0.70, 1, 0.90, 'staff'), 0.75, 1e-12);
// Lock 0: starter gets nothing, pen 0.55, rest neutral -> 0.8*0.55 + 0.45.
checkClose('lock 0 pure pen', blendMlbPitchingFactors(1.40, 0, 0.80, 'bullpen'), 0.89, 1e-12);
// Starter still the majority at full lock (tier 1 > tier 2).
const blendW = blendMlbPitchingFactors(0.70, 1, 1.25, 'bullpen');
checkTrue('starter keeps majority at full lock', blendW < (0.70 + 1.25) / 2);

// ---------- TIER 4: infielder OPS math ----------
// 460 AB, 119 H, 24 2B, 0 3B, 22 HR, 44 BB:
// singles=73, TB=209, SLG=.4543, OBP=163/504=.3234, OPS=.7778.
const opsEx = opsFromMlbBatting({ atBats: 460, hits: 119, doubles: 24, triples: 0, homeRuns: 22, walks: 44 });
checkClose('OPS computed from counting stats', opsEx, 0.77776, 1e-4);
check('null input -> null', opsFromMlbBatting(null), null);
check('zero AB -> null', opsFromMlbBatting({ atBats: 0, hits: 0 }), null);
// League-average bat is neutral at every tier.
checkClose('avg OPS neutral SS', mlbInfielderFactorFromOps(0.72, 'ss'), 1.0, 1e-12);
checkClose('avg OPS neutral 1B', mlbInfielderFactorFromOps(0.72, '1b'), 1.0, 1e-12);
checkClose('avg OPS neutral 2B/3B', mlbInfielderFactorFromOps(0.72, '23'), 1.0, 1e-12);
// Monster 1.000 OPS: raw 1.14 -> SS 1.12, 1B 1.10, 2B/3B 1.08.
checkClose('1.000 OPS SS -> 1.12', mlbInfielderFactorFromOps(1.000, 'ss'), 1.12, 1e-12);
checkClose('1.000 OPS 1B -> 1.10', mlbInfielderFactorFromOps(1.000, '1b'), 1.10, 1e-12);
checkClose('1.000 OPS 2B/3B -> 1.08', mlbInfielderFactorFromOps(1.000, '23'), 1.08, 1e-12);
// Strict sub-ladder: SS > 1B > 2B/3B.
checkTrue('SS ceiling > 1B ceiling', mlbInfielderFactorFromOps(2.0, 'ss') > mlbInfielderFactorFromOps(2.0, '1b'));
checkTrue('1B ceiling > 2B/3B ceiling', mlbInfielderFactorFromOps(2.0, '1b') > mlbInfielderFactorFromOps(2.0, '23'));
// Automatic out: .500 OPS -> 1 + (0.5-0.72)/2 = 0.89.
checkClose('weak bat .500 OPS SS', mlbInfielderFactorFromOps(0.500, 'ss'), 0.89, 1e-12);
check('invalid OPS neutral', mlbInfielderFactorFromOps(null, 'ss'), 1);

// ---------- Tier ladder inside calculateLambdaMultiplier ----------
// Clamps hold on the new slots.
checkClose('ssFactor clamped at 1.12', calculateLambdaMultiplier({ ssFactor: 9 }), 1.12, 1e-12);
checkClose('firstBaseFactor clamped at 1.10', calculateLambdaMultiplier({ firstBaseFactor: 9 }), 1.10, 1e-12);
checkClose('secondThirdFactor clamped at 1.08', calculateLambdaMultiplier({ secondThirdFactor: 9 }), 1.08, 1e-12);
// Full strict ladder by max swing: 1.40 > 1.25 > 1.12 > 1.10 > 1.08.
const mSS = calculateLambdaMultiplier({ ssFactor: 9 });
const m1B = calculateLambdaMultiplier({ firstBaseFactor: 9 });
const m23 = calculateLambdaMultiplier({ secondThirdFactor: 9 });
checkTrue('ladder SS > 1B > 2B/3B', mSS > m1B && m1B > m23);
// Neutral by default.
checkClose('all-neutral -> 1', calculateLambdaMultiplier({}), 1, 1e-12);

// ---------- Seeded sim behavior ----------
// MLB base: 4.5 runs each side -> ~50/50.
const baseCtx = { league: 'MLB', offenseA: 4.5, defenseA: 4.5, offenseB: 4.5, defenseB: 4.5 };
const coin = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000 }));
checkTrue('coin-flip baseline ~50/50', coin.winPctA >= 49 && coin.winPctA <= 51);
// An elite ace (T1, 0.70 on the opponent) beats a hot lineup (5.5 runs).
const aceVsBats = withSeed(42, () => runTeamSportSimulation({
  ...baseCtx, offenseB: 5.5, trials: 40000, contextB: { pitcherFactor: 0.70 }
}));
const hotBats = withSeed(42, () => runTeamSportSimulation({
  ...baseCtx, offenseB: 5.5, trials: 40000
}));
checkTrue('hot lineup alone favors B', hotBats.winPctA < 50);
checkTrue('elite ace beats the hot lineup', aceVsBats.winPctA > 50);
// The bullpen fix moves the sim: a true 0.80 pen suppresses more than the old
// flattened 0.86.
const penNew = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000, contextB: { pitcherFactor: 0.80 } }));
const penOld = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000, contextB: { pitcherFactor: 0.86 } }));
checkTrue('fixed pen suppresses more than flattened pen', penNew.winPctA > penOld.winPctA);
// A great shortstop's bat (T4, 1.12 on own runs) outweighs home field (+0.15
// runs for the other side).
const ssEdge = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000, contextA: { ssFactor: 1.12 } }));
const homeEdge = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000, contextB: { homeFieldPts: 0.15 } }));
checkTrue('SS bat outweighs home field', (ssEdge.winPctA - 50) > (50 - homeEdge.winPctA));
// MLB still always picks a winner — no 50/50 path (Drew's standing call).
const deadEven = withSeed(7, () => runTeamSportSimulation({ ...baseCtx, trials: 40000 }));
checkTrue('dead-even resolves to 100%', deadEven.winPctA + deadEven.winPctB === 100);
checkTrue('tie% stays 0', deadEven.tiePct === 0);
checkTrue('shouldBeFiftyFifty never mentions MLB', !/MLB/.test(src.match(/function shouldBeFiftyFifty[\s\S]*?\n}/)[0]));

// ---------- Untouched guardrails ----------
check('shrinkage is 0.40', CONSERVATISM_SHRINKAGE, 0.40);
check('MLB still bivariate Poisson', SCORING_MODEL.MLB.dist, 'bivariate_poisson');
check('MLB base still 4.5', LEAGUE_AVERAGE_FALLBACKS.MLB, 4.5);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('ALL BASEBALL-TIERED-HIERARCHY CHECKS PASSED');
