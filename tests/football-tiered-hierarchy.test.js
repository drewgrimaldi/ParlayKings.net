// FOOTBALL TIERED HIERARCHY (Drew's call 2026-09-23), superseded for NFL/CFB
// by the 15-factor weighted composite (Drew's call 2026-10-02): the factor
// functions below are still the INPUT layer (QB -> pitcherFactor, O-line /
// pass rush -> trench inputs, kicker -> CFB special-teams proxy), but the sim
// now prices them as head-to-head point edges instead of multiplicative
// tiers. The RB/WR standalone factors and the old QB composite factor are
// retired from the sim path.
// Tier order with max per-team swing (legacy multiplicative path):
//   T1  QB            0.70-1.40 (single dominant factor; pass YPA/YPG no longer
//                             also live in the generic efficiency factor)
//   T1  RB (lead back YPC)  0.88-1.12
//   T1  WR (WR1 YPR)        0.90-1.10
//   T2  O-line (sacks allowed, rush YPC, yards per play)  0.92-1.08
//   T3  pass rush (opp sacks, TFL, turnovers forced)      0.93-1.06
//   T4  kicker (actual kicker FG%)    0.95-1.04
//   T5  remaining efficiency (3rd/4th down, RZ, INT, pace...)  0.96-1.03
//   T6  home field, rest, weather, travel, recent form (unchanged, smallest)
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
  // Skip past the parameter list (it may contain destructuring braces).
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
const footballLeagueAverages = extract('footballLeagueAverages', { normalizeLeague });
const footballProfileToFactor = extract('footballProfileToFactor', { footballLeagueAverages });
const footballRbFactorFromYpc = extract('footballRbFactorFromYpc', { footballLeagueAverages });
const footballWrFactorFromYpr = extract('footballWrFactorFromYpr');
const footballKickerFactorFromFgPct = extract('footballKickerFactorFromFgPct', { footballLeagueAverages });
const footballOffensiveLineFactor = extract('footballOffensiveLineFactor', { footballLeagueAverages });
const footballPassRushFactor = extract('footballPassRushFactor', { footballLeagueAverages });
const qbScaleForLeague = extract('qbScaleForLeague');
const qbFactorFromValue = extract('qbFactorFromValue', { qbScaleForLeague });
const calculateLambdaMultiplier = extract('calculateLambdaMultiplier', {
  SOS_POINTS_TO_FACTOR, TURNOVER_LUCK_DAMPEN, POINTS_PER_TURNOVER,
  FOOTBALL_WIND_20_FACTOR, FOOTBALL_WIND_15_FACTOR
});
const isFootballLeague = extract('isFootballLeague', { normalizeLeague });
const footballBounds = extract('footballBounds', { normalizeLeague, FOOTBALL_SCORE_BOUNDS });
const clampFootballLambda = extract('clampFootballLambda', { footballBounds, normalizeLeague });
const clampFootballScore = extract('clampFootballScore', { footballBounds });
const sampleNormal = extract('sampleNormal');
const bridgeToTeamSim = extract('bridgeToTeamSim', {
  LEAGUE_AVERAGE_FALLBACKS, isFootballLeague, clampFootballLambda,
  calculateLambdaMultiplier, footballBounds
});
const runTeamSportSimulation = extract('runTeamSportSimulation', {
  SCORING_MODEL, bridgeToTeamSim, sampleNormal, isFootballLeague,
  clampFootballScore, CONSERVATISM_SHRINKAGE
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
// Deterministic sims: seeded PRNG so win% assertions can't flake.
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

// ---------- TIER 1: QB is the single dominant weight ----------
const nflScale = qbScaleForLeague('NFL');
// Elite NFL passer (125.8): 1 + (125.8-90)/150 = 1.2387 — same as before.
checkClose('elite NFL QB factor', qbFactorFromValue(125.8, nflScale.avg, nflScale.div, 0.70, 1.40), 1 + 35.8 / 150, 1e-12);
// New tier-1 ceiling: a perfect 158.3 rating tops out at 1.40 (was 1.25).
checkClose('perfect-rating NFL QB hits 1.40', qbFactorFromValue(158.3, nflScale.avg, nflScale.div, 0.70, 1.40), 1.40, 1e-12);
// New tier-1 floor: a 50 rating bottoms at 0.70 (was 0.80).
checkClose('bad NFL QB hits 0.70 floor', qbFactorFromValue(50, nflScale.avg, nflScale.div, 0.70, 1.40), 0.70, 1e-12);
// Default clamps are untouched for the other league paths (still 0.8-1.25).
checkClose('default QB clamp unchanged', qbFactorFromValue(50, nflScale.avg, nflScale.div), 0.8, 1e-12);
// CFB elite (182.4, avg 135, div 225): 1 + 47.4/225 = 1.2107 — inside the wider ceiling.
const cfbScale = qbScaleForLeague('CFB');
checkClose('elite CFB QB factor', qbFactorFromValue(182.4, cfbScale.avg, cfbScale.div, 0.70, 1.40), 1 + 47.4 / 225, 1e-12);

// ---------- QB consolidation: passing no longer also lives in efficiency ----------
// Team PPG stays the scoring engine — the efficiency factor just stops echoing
// the QB's own arm. Pass YPA / pass YPG bits must be gone, FG/XP/sack bits gone
// (they moved to the kicker and O-line tier factors).
const pack = footballProfileToFactor({
  gamesPlayed: 10, passYpa: 8.0, passYpg: 280, yardsPerGame: 400,
  sackPct: 8, fgPct: 92, xpPct: 99, thirdDownPct: 45, rushYpg: 120, fourthDownPct: 55
}, null, 'NFL', 10);
checkTrue('no pass-YPA bit in efficiency', !pack.bits.some((b) => b.startsWith('pass ')));
checkTrue('no sack bit in efficiency (moved to O-line)', !pack.bits.some((b) => b.startsWith('sack')));
checkTrue('no FG/XP bits in efficiency (moved to kicker)', !pack.bits.some((b) => b.startsWith('FG') || b.startsWith('XP')));

// ---------- TIER 1: RB lead-back factor ----------
checkClose('RB 5.5 YPC -> 1.10', footballRbFactorFromYpc(5.5, 'NFL'), 1.10, 1e-12);
checkClose('RB 4.3 YPC -> 1.0', footballRbFactorFromYpc(4.3, 'NFL'), 1.0, 1e-12);
checkClose('RB 2.0 YPC -> clamped 0.88', footballRbFactorFromYpc(2.0, 'NFL'), 0.88, 1e-12);
// CFB anchor differs (4.8): a 4.3 college back is slightly below average.
checkClose('CFB RB 4.3 YPC -> < 1', footballRbFactorFromYpc(4.3, 'CFB') < 1, true);

// ---------- TIER 1: WR factor ----------
checkClose('WR 15 YPR -> 1.10', footballWrFactorFromYpr(15), 1.10, 1e-12);
checkClose('WR 11 YPR -> 1.0', footballWrFactorFromYpr(11), 1.0, 1e-12);
checkClose('WR 5 YPR -> clamped 0.90', footballWrFactorFromYpr(5), 0.90, 1e-12);

// ---------- TIER 2: O-line factor ----------
// Elite line: low sack %, strong rush YPC, strong yards/play -> above 1, capped 1.08.
const goodLine = footballOffensiveLineFactor({ sackPct: 4, rushYpc: 5.2, yardsPerPlay: 6.2, gamesPlayed: 10 }, 'NFL');
checkTrue('elite O-line factor > 1', goodLine.factor > 1);
checkTrue('elite O-line factor <= 1.08', goodLine.factor <= 1.08);
checkTrue('elite O-line traces bits', goodLine.bits.length > 0);
// Bad line: high sack %, weak rush YPC -> below 1, floored 0.92.
const badLine = footballOffensiveLineFactor({ sackPct: 12, rushYpc: 3.4, yardsPerPlay: 4.4, gamesPlayed: 10 }, 'NFL');
checkTrue('bad O-line factor < 1', badLine.factor < 1);
checkTrue('bad O-line factor >= 0.92', badLine.factor >= 0.92);
// Missing data is neutral.
check('O-line no-data -> 1', footballOffensiveLineFactor(null, 'NFL').factor, 1);

// ---------- TIER 3: pass-rush factor (from the OPPONENT's profile) ----------
const fierceRush = footballPassRushFactor({ sacksCreated: 45, tfl: 90, takeaways: 25, gamesPlayed: 10 }, 'NFL', 10);
checkTrue('fierce opp pass rush drags below 1', fierceRush.factor < 1);
checkTrue('pass rush floored at 0.93', fierceRush.factor >= 0.93);
const weakRush = footballPassRushFactor({ sacksCreated: 10, tfl: 30, takeaways: 8, gamesPlayed: 10 }, 'NFL', 10);
checkTrue('weak opp pass rush lifts above 1', weakRush.factor > 1);
checkTrue('pass rush capped at 1.06', weakRush.factor <= 1.06);

// ---------- TIER 4: kicker factor ----------
checkClose('kicker 95% NFL -> clamped 1.04', footballKickerFactorFromFgPct(95, 'NFL'), 1.04, 1e-12);
checkClose('kicker 84% NFL -> 1.0', footballKickerFactorFromFgPct(84, 'NFL'), 1.0, 1e-12);
checkClose('kicker 60% NFL -> clamped 0.95', footballKickerFactorFromFgPct(60, 'NFL'), 0.95, 1e-12);
// Missing data is neutral.
check('kicker no-data -> 1', footballKickerFactorFromFgPct(null, 'NFL'), 1);

// ---------- TIER 5: efficiency demoted (clamped 0.96-1.03) ----------
// Even a profile maxed on every remaining bit cannot exceed the tier-5 cap.
const maxed = footballProfileToFactor({
  gamesPlayed: 17, thirdDownPct: 60, rushYpg: 180, fourthDownPct: 80,
  redZoneTdPct: 80, intPct: 0.3, fumbleRate: 0, topSeconds: 2000, secondsPerPlay: 22,
  puntNet: 48, puntIn20Pct: 60, kickTouchbackPct: 90, kickRetAvg: 30,
  fourthDownAtt: 10, penaltiesPerGame: 2, explosivePlayRate: 20, returnTd: 3
}, null, 'NFL', 17);
checkTrue('maxed efficiency factor capped at 1.03', maxed.factor <= 1.03);
checkTrue('maxed efficiency factor hits the 1.03 cap', maxed.factor === 1.03);
// A merely good efficiency sheet still moves, but small.
const decent = footballProfileToFactor({ gamesPlayed: 10, thirdDownPct: 50, rushYpg: 140 }, null, 'NFL', 10);
checkTrue('decent efficiency nudges above 1', decent.factor > 1);
checkTrue('decent efficiency stays well under tier-4 max', decent.factor < 1.04);

// ---------- TIER LADDER: each tier's max swing beats the next tier down ----------
// The ordering IS the feature: T1 > T2 > T3 > T4 > T5 > T6.
const m = (ctx) => calculateLambdaMultiplier(ctx);
checkClose('T1 QB max', m({ pitcherFactor: 1.40 }), 1.40, 1e-12);
checkClose('T1 RB max', m({ rbFactor: 99 }), 1.12, 1e-12);
checkClose('T1 WR max', m({ wrFactor: 99 }), 1.10, 1e-12);
checkClose('T2 O-line max', m({ olineFactor: 99 }), 1.08, 1e-12);
checkClose('T3 pass-rush max', m({ passRushFactor: 99 }), 1.06, 1e-12);
checkClose('T4 kicker max', m({ kickerFactor: 99 }), 1.04, 1e-12);
checkClose('T5 efficiency max', m({ footballFactor: 99 }), 1.03, 1e-12);
checkClose('T6 rest max', m({ restDays: 9 }), 1.02, 1e-12);
const ladder = [m({ pitcherFactor: 1.40 }), m({ rbFactor: 99 }), m({ wrFactor: 99 }), m({ olineFactor: 99 }), m({ passRushFactor: 99 }), m({ kickerFactor: 99 }), m({ footballFactor: 99 }), m({ restDays: 9 })];
checkTrue('tier ladder strictly decreasing', ladder.every((v, i) => i === 0 || ladder[i - 1] > v));

// ---------- BEHAVIOR: tier 1 beats tier 6 ----------
// An elite-QB team in bad form still out-simulates a bad-QB team in great form.
const eliteQbBadForm = m({ pitcherFactor: 1.30, recentFormDiff: -8 });
const badQbGoodForm = m({ pitcherFactor: 0.75, recentFormDiff: 12 });
checkTrue('elite QB + bad form beats bad QB + good form', eliteQbBadForm > badQbGoodForm);
// An elite WR1 moves the sim more than the best possible rest advantage.
checkTrue('elite WR > max rest', m({ wrFactor: 1.10 }) > m({ restDays: 30 }));
// O-line point swing outweighs home field: on a 28-pt base, 1.08 adds 2.24 pts
// while HFA adds a flat 2.
const bridgeOL = bridgeToTeamSim({ league: 'NFL', offenseA: 28, defenseB: 22, offenseB: 24, defenseA: 22, contextA: { olineFactor: 1.08 } });
const bridgeHFA = bridgeToTeamSim({ league: 'NFL', offenseA: 28, defenseB: 22, offenseB: 24, defenseA: 22, contextA: {}, homeFieldPts: 2 });
checkTrue('elite O-line swing > home field', bridgeOL.lambdaA - 28 > bridgeHFA.lambdaA - 28);
// A good kicker flips an otherwise coin-flip matchup: baseline is ~50/50,
// the 1.04 kicker factor pushes team A clearly over.
const baseCtx = { league: 'NFL', offenseA: 24, defenseB: 22, offenseB: 24, defenseA: 22 };
const coin = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000 }));
checkTrue('coin-flip baseline ~50/50', coin.winPctA >= 49 && coin.winPctA <= 51);
const withK = withSeed(42, () => runTeamSportSimulation({ ...baseCtx, trials: 40000, contextA: { kickerFactor: 1.04 } }));
checkTrue('kicker flips the coin-flip', withK.winPctA > coin.winPctA + 1);
checkTrue('kicker win% clearly above 50', withK.winPctA >= 51.5);
// Football still always picks a winner (no 50/50 logging path on ties).
const deadEven = withSeed(7, () => runTeamSportSimulation({ ...baseCtx, trials: 40000 }));
checkTrue('dead-even game resolves to 100%', deadEven.winPctA + deadEven.winPctB === 100);
checkTrue('tie% stays 0', deadEven.tiePct === 0);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('ALL FOOTBALL-TIERED-HIERARCHY CHECKS PASSED');
