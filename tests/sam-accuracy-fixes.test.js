// Verification suite for the clean SAM 1.7.2 bug fixes (zero stdDev / anchor changes).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extractFn(name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error('function missing from bundle: ' + name);
  let i = m.index + m[0].length, pdepth = 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') pdepth++;
    if (src[i] === ')') { pdepth--; if (!pdepth) break; }
  }
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(m.index, j + 1);
}

function extractConst(name) {
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*'));
  if (!m) throw new Error('const missing from bundle: ' + name);
  let i = m.index + m[0].length;
  if (src[i] === '{' || src[i] === '[') {
    const open = src[i], close = open === '{' ? '}' : ']';
    let depth = 0, instr = false, q = '';
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (instr) { if (c === q && src[j - 1] !== '\\') instr = false; continue; }
      if (c === '"' || c === "'" || c === '`') { instr = true; q = c; continue; }
      if (c === open) depth++;
      if (c === close) { depth--; if (!depth) return src.slice(m.index, j + 1); }
    }
    throw new Error('unterminated literal for ' + name);
  }
  const end = src.indexOf(';', i);
  return src.slice(m.index, end + 1);
}

for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  globalThis[n] = (f) => f;
}

const bundle = [
  extractConst('SCORING_MODEL'),
  extractConst('NHL_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('NHL_NAME_TO_ABBR').replace(/^const /, 'var '),
  extractConst('NHL_MONEYPUCK').replace(/^const /, 'var '),
  extractConst('FOOTBALL_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_TEAM_ADV').replace(/^const /, 'var '),
  extractConst('NFL_NAME_TO_ABBR').replace(/^const /, 'var '),
  extractConst('NFL_TEAM_EPA').replace(/^const /, 'var '),
  extractConst('NBA_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  'var _nhlMoneypuckCache = { at: 0, table: null };',
  'var KV_STAT_TTL_MS = 3600e3;',
  'var WTA_EDGE_HOLD_SCALE = 0.08;',
  'var FOOTBALL_WIND_15_FACTOR = 0.985;',
  'var FOOTBALL_WIND_20_FACTOR = 0.97;',
  'var SOS_POINTS_TO_FACTOR = 8e-3;',
  'var TURNOVER_LUCK_DAMPEN = 0.3;',
  'var POINTS_PER_TURNOVER = 4.5;',
  extractFn('calculateLambdaMultiplier'),
  extractFn('sosShrinkage'),
  extractFn('kvStatTable'),
  extractFn('getNhlMoneypuckTable'),
  extractFn('nhlAbbrForTeamName'),
  extractFn('nhlMoneypuckForTeamName'),
  extractFn('nhlGsaxForGoalie'),
  extractFn('nhlClampEdge'),
  extractFn('nhlWeightedCompositeEdge'),
  extractFn('normalizeLeague'),
  extractFn('basketballLeagueAverages'),
  extractFn('nbaWeightedCompositeEdge'),
  extractFn('nflEpaForTeamName'),
  extractFn('cfbAdvForTeamName'),
  extractFn('footballClampEdge'),
  extractFn('cfbWeightedCompositeEdge'),
  extractFn('footballWeightedCompositeEdge'),
  extractFn('simulateTennisSet'),
].join('\n');
eval(bundle);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', name, extra === undefined ? '' : extra); }
}

(async () => {
  // 1. SCORING_MODEL untouched
  check('SCORING_MODEL untouched (NFL 7, CFB 8, NBA 12, CBB 10)',
    SCORING_MODEL.NFL.stdDev === 7 && SCORING_MODEL.CFB.stdDev === 8 &&
    SCORING_MODEL.NBA.stdDev === 12 && SCORING_MODEL.CBB.stdDev === 10);

  // 2. NHL KV table loader & PDO regression sign flip
  const mockTeams = {};
  for (const abbr of Object.values(NHL_NAME_TO_ABBR).slice(0, 20)) {
    mockTeams[abbr] = { gp: 20, xgf_pct: 0.5, cf_pct: 0.5, ff_pct: 0.5, hdcf_pct: 0.5, p60: 6.0, ixg60: 2.5, prim60: 4.0, pdo: 1.0 };
  }
  mockTeams.DET.pdo = 1.05;
  mockTeams.DAL.pdo = 0.95;
  const mockKvTable = { season: 2026, teams: mockTeams, goalies: [] };
  const mockEnv = { SAM_BETS: { get: async (k) => k === 'nhl_moneypuck_v1' ? JSON.stringify(mockKvTable) : null } };
  const loadedNhl = await getNhlMoneypuckTable(mockEnv);
  check('NHL KV loader returns live table for teams missing from embedded constant', !!loadedNhl.teams.DET && !!loadedNhl.teams.DAL);
  const pdoEdge = nhlWeightedCompositeEdge({ teamA: 'Detroit Red Wings', teamB: 'Dallas Stars', moneypuckTable: loadedNhl });
  check('NHL PDO regresses luckier team downward', pdoEdge.edge < 0, pdoEdge.edge);

  // 3. NFL weather no longer penalizes Team A directionally, still widens variance
  const wxRes = footballWeightedCompositeEdge({
    teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
    ctxA: { windMph: 25, tempF: 18 }, ctxB: { windMph: 25, tempF: 18 },
    profA: {}, profB: {}, gpA: 8, gpB: 8, league: 'NFL', avgPoints: 22,
  });
  check('NFL bad weather produces 0 directional edge', wxRes.edge === 0, wxRes.edge);
  check('NFL bad weather still widens variance (varMult > 1)', wxRes.varMult > 1, wxRes.varMult);

  // 4. NFL composite is injury-neutral: injuries are priced in the lambda
  // multiplier, where they scale with scoring level (and cover CFB).
  const nflInjA = footballWeightedCompositeEdge({
    teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
    ctxA: { injuryCountFactor: 0.88 }, ctxB: {},
    profA: {}, profB: {}, gpA: 8, gpB: 8, league: 'NFL', avgPoints: 22,
  });
  check('NFL composite does not price injuries (multiplier does)', nflInjA.edge === 0, nflInjA.edge);

  // 5. NBA live injuryCountFactor fires (including one-sided) and pace is neutral
  const baseProfile = { gamesPlayed: 20, efg: 54, tovPct: 13, oreb: 24, dreb: 70, ftRate: 0.25, threePct: 36, pace: 100, tpm: 12, fgm: 40, pts: 112 };
  const baseStats = { offense: 112, defense: 112, gamesPlayed: 20, basketballProfile: baseProfile };
  const nbaInj = nbaWeightedCompositeEdge({
    teamA: 'A', teamB: 'B', statsA: baseStats, statsB: baseStats,
    ctxA: { injuryCountFactor: 0.90 }, ctxB: {}, league: 'NBA',
  });
  check('NBA composite does not price injuries (multiplier does)', nbaInj.edge === 0, nbaInj.edge);

  const fastStats = { ...baseStats, basketballProfile: { ...baseProfile, pace: 106 } };
  const slowStats = { ...baseStats, basketballProfile: { ...baseProfile, pace: 94 } };
  const paceRes = nbaWeightedCompositeEdge({
    teamA: 'Fast', teamB: 'Slow', statsA: fastStats, statsB: slowStats,
    ctxA: {}, ctxB: {}, league: 'NBA',
  });
  check('NBA pace factor does not fire as directional edge', !paceRes.bits.some((b) => b.startsWith('pace ')), paceRes.bits);

  // 5b. Matchup factor must not leak pace directionally either: profiles that
  // differ ONLY in pace produce zero edge.
  check('NBA matchup factor has no pace leak (pace-only diff = 0 edge)', paceRes.edge === 0, paceRes.edge);

  // 6. Tennis first server is randomized
  let aWins = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (simulateTennisSet(0.80, 0.80, 0) === 'A') aWins++;
  const aRate = aWins / N;
  check('Tennis equal-hold set simulation is unbiased (~50%)', Math.abs(aRate - 0.5) < 0.02, aRate);

  // 7. Lambda multiplier: rest / form / injury are priced HERE at full
  // scoring-level scale, whether or not a composite is on — the composites'
  // own blocks are neutral, and CFB's composite has none of these factors.
  const lamGatedF = calculateLambdaMultiplier({ restDays: 0, recentFormDiff: 5, injuryCountFactor: 0.9, footballCompositeOn: true });
  const lamGatedB = calculateLambdaMultiplier({ restDays: 0, recentFormDiff: 5, injuryCountFactor: 0.9, basketballCompositeOn: true });
  const lamOpen = calculateLambdaMultiplier({ restDays: 0, recentFormDiff: 5, injuryCountFactor: 0.9 });
  check('Lambda rest/form/injury stay active when football composite on', lamGatedF === lamOpen && lamOpen < 0.95, lamGatedF + ' vs ' + lamOpen);
  check('Lambda rest/form/injury stay active when basketball composite on', lamGatedB === lamOpen, lamGatedB + ' vs ' + lamOpen);

  // 8. Football composite must not price home field a second time:
  // homeFieldPts is applied once in bridgeToTeamSim.
  const hfaRes = footballWeightedCompositeEdge({
    teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
    ctxA: { homeFieldPts: 2 }, ctxB: {},
    profA: {}, profB: {}, gpA: 8, gpB: 8, league: 'NFL', avgPoints: 22,
  });
  check('Football composite does not re-price homeFieldPts', hfaRes.edge === 0, hfaRes.edge);

  // 9. Composites are rest/form neutral too (priced in the multiplier).
  const fbFormRest = footballWeightedCompositeEdge({
    teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
    ctxA: { recentFormDiff: 5, restDays: 0 }, ctxB: { recentFormDiff: -5, restDays: 3 },
    profA: {}, profB: {}, gpA: 8, gpB: 8, league: 'NFL', avgPoints: 22,
  });
  check('Football composite does not price rest/form', fbFormRest.edge === 0, fbFormRest.edge);
  const nbaFormRest = nbaWeightedCompositeEdge({
    teamA: 'A', teamB: 'B', statsA: baseStats, statsB: baseStats,
    ctxA: { recentFormDiff: 5, restDays: 0 }, ctxB: { recentFormDiff: -5, restDays: 2 }, league: 'NBA',
  });
  check('NBA composite does not price rest/form', nbaFormRest.edge === 0, nbaFormRest.edge);

  // 10. Strength of schedule: sosDiff moves the lambda multiplier through
  // its single sosFactor application (SOS_POINTS_TO_FACTOR 0.008, clamped
  // [0.94, 1.06]); shrinkage damps thin game samples; missing sos is
  // neutral (the multiplier's default 0 leaves the factor at exactly 1).
  const sosBase = calculateLambdaMultiplier({});
  const sosPlus = calculateLambdaMultiplier({ sosDiff: 6 });
  const sosMinus = calculateLambdaMultiplier({ sosDiff: -6 });
  check('sosDiff +6 raises the multiplier by exactly 6 x 0.008', Math.abs(sosPlus / sosBase - 1.048) < 1e-9, sosPlus);
  check('sosDiff -6 lowers the multiplier symmetrically', Math.abs(sosMinus / sosBase - 0.952) < 1e-9, sosMinus);
  check('sosDiff clamps at +1.06 / 0.94', calculateLambdaMultiplier({ sosDiff: 12 }) / sosBase === 1.06 && calculateLambdaMultiplier({ sosDiff: -12 }) / sosBase === 0.94, '');
  check('Missing sosDiff stays neutral (factor 1)', sosBase === 1 && calculateLambdaMultiplier({ sosDiff: 0 }) === 1, sosBase);
  check('sosShrinkage: full weight at 8+ games', sosShrinkage(8, 12) === 1 && sosShrinkage(11, 11) === 1, sosShrinkage(8, 12));
  check('sosShrinkage: damps thin samples, floor 0.12', sosShrinkage(4, 9) === 0.5 && sosShrinkage(2, 3) === 0.25 && sosShrinkage(0, 0) === 0.12, sosShrinkage(4, 9) + '/' + sosShrinkage(0, 0));
  check('sosShrinkage: missing gp counts as 0 games', sosShrinkage(undefined, 10) === 0.12 && sosShrinkage(10, null) === 0.12, '');

  console.log(`sam-accuracy-fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
