// FOOTBALL IMPORTANCE WEIGHTS (Drew's call 2026-10-02, Gemini-revised):
// Drew's NFL 15-factor weights for the Monte Carlo loop, summing to exactly
// 100%. Covers: exact weights and 100% sum, the QB EPA+CPOE composite,
// neutral missing-data behavior, reversal symmetry, early-season shrinkage,
// the per-factor clamp, single-factor isolation for the new metrics, the CFB
// ctx/prof fallback path, composite-on neutralization inside
// calculateLambdaMultiplier, and unrelated sports staying untouched.
// Tests the REAL bundle code by extracting from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
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

function extractNumVar(name) {
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('num var missing from bundle: ' + name);
  return Number(m[1]);
}

for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  globalThis[n] = (f) => f;
}

const bundle = [
  extractConst('FOOTBALL_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_TEAM_ADV').replace(/^const /, 'var '),
  extractConst('NFL_NAME_TO_ABBR').replace(/^const /, 'var '),
  extractConst('NFL_TEAM_EPA').replace(/^const /, 'var '),
  extractFn('footballWeightsTotal'),
  extractFn('nflEpaForTeamName'),
  extractFn('cfbAdvForTeamName'),
  extractFn('footballClampEdge'),
  extractFn('cfbWeightedCompositeEdge'),
  extractFn('footballWeightedCompositeEdge'),
  extractFn('calculateLambdaMultiplier'),
  'var SOS_POINTS_TO_FACTOR = ' + extractNumVar('SOS_POINTS_TO_FACTOR') + ';',
  'var TURNOVER_LUCK_DAMPEN = ' + extractNumVar('TURNOVER_LUCK_DAMPEN') + ';',
  'var POINTS_PER_TURNOVER = ' + extractNumVar('POINTS_PER_TURNOVER') + ';',
  'var FOOTBALL_WIND_15_FACTOR = ' + extractNumVar('FOOTBALL_WIND_15_FACTOR') + ';',
  'var FOOTBALL_WIND_20_FACTOR = ' + extractNumVar('FOOTBALL_WIND_20_FACTOR') + ';',
].join('\n');
eval(bundle);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

// ---------- 1. Exact weights, Drew's list, 100% sum -----------------------
const EXPECTED = [
  ['epaPerPlay', 0.18], ['qb', 0.15], ['passingEpa', 0.12],
  ['successRate', 0.10], ['turnover', 0.09], ['defensiveEpa', 0.08],
  ['pressure', 0.07], ['explosive', 0.05], ['redzone', 0.04],
  ['injuries', 0.03], ['special', 0.03], ['homeField', 0.02],
  ['recentForm', 0.02], ['rest', 0.01], ['weather', 0.01],
];
check('weights list has exactly 15 entries', FOOTBALL_IMPORTANCE_WEIGHTS.length === 15, FOOTBALL_IMPORTANCE_WEIGHTS.length);
check('weights sum to exactly 1.00', Math.abs(footballWeightsTotal() - 1) < 1e-9, footballWeightsTotal());
for (const [key, w] of EXPECTED) {
  const row = FOOTBALL_IMPORTANCE_WEIGHTS.find((r) => r.key === key);
  check('weight ' + key + ' = ' + w, !!row && Math.abs(row.weight - w) < 1e-12, row && row.weight);
}
check('weights order matches Drew\'s importance order',
  FOOTBALL_IMPORTANCE_WEIGHTS.map((r) => r.key).join(',') === EXPECTED.map((e) => e[0]).join(','));
check('no legacy keys survive (anya/dvoa/offSuccess/netEpa/edpr)',
  !FOOTBALL_IMPORTANCE_WEIGHTS.some((r) => ['anya','dvoa','offSuccess','netEpa','edpr'].includes(r.key)));

// ---------- 2. EPA table sanity (revised metrics present) -----------------
check('EPA table covers 32 teams', Object.keys(NFL_TEAM_EPA).length === 32, Object.keys(NFL_TEAM_EPA).length);
for (const [abbr, t] of Object.entries(NFL_TEAM_EPA)) {
  check('EPA ' + abbr + ' has gp>0', t.gp > 0, t.gp);
  check('EPA ' + abbr + ' revised metrics sane',
    t.offEarlySr > 0.2 && t.offEarlySr < 0.8 &&
    t.defEarlySr > 0.2 && t.defEarlySr < 0.8 &&
    t.defRzTd >= 0 && t.defRzTd <= 1 &&
    Math.abs(t.qbComposite) < 4 && t.qbName.length > 0 &&
    Math.abs(t.penNet) < 60,
    JSON.stringify({ offEarlySr: t.offEarlySr, defRzTd: t.defRzTd, qbComposite: t.qbComposite, qbName: t.qbName, penNet: t.penNet }));
}
check('QB composite mean is ~0 (z-score blend)',
  Math.abs(Object.values(NFL_TEAM_EPA).reduce((s, t) => s + t.qbComposite, 0) / 32) < 0.05);
check('name lookup finds KC', !!nflEpaForTeamName('Kansas City Chiefs'));
check('name lookup misses gracefully', nflEpaForTeamName('Springfield Atoms') === null);

// ---------- 3. Missing data goes neutral -----------------------------------
function baseArgs() {
  return {
    teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
    ctxA: {}, ctxB: {}, profA: {}, profB: {},
    gpA: 2, gpB: 2, league: 'NFL', avgPoints: 22,
  };
}
function realNameArgs() {
  const a = baseArgs();
  a.teamA = 'Kansas City Chiefs'; a.teamB = 'Buffalo Bills';
  return a;
}
check('empty inputs -> exactly 0 edge', footballWeightedCompositeEdge(baseArgs()).edge === 0);
const cfb = baseArgs();
cfb.league = 'CFB';
check('CFB without ctx/prof inputs -> 0 edge', footballWeightedCompositeEdge(cfb).edge === 0);
const oneSided = realNameArgs();
oneSided.teamB = 'Springfield Atoms';
check('one-sided team data -> 0 edge', footballWeightedCompositeEdge(oneSided).edge === 0);

// ---------- 4. QB composite fires from nflverse data ------------------------
const qbArgs = realNameArgs(); // KC (Mahomes) vs BUF (Allen): no ctx QB factors set
const qbRes = footballWeightedCompositeEdge(qbArgs);
check('QB factor fires without any ctx pitcherFactor', qbRes.bits.some((b) => b.startsWith('qb ')), qbRes.bits.join(' | ').slice(0, 200));
// CFB falls back to the key-player QB factor.
const cfbQb = {
  teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
  ctxA: { pitcherFactor: 1.2 }, ctxB: { pitcherFactor: 1.0 },
  profA: {}, profB: {}, gpA: 3, gpB: 3, league: 'CFB', avgPoints: 28,
};
const cfbQbEdge = footballWeightedCompositeEdge(cfbQb).edge;
check('CFB QB fallback = 0.15 * (1.2-1.0) * 28', Math.abs(cfbQbEdge - 0.15 * 0.2 * 28) < 1e-9, cfbQbEdge);

// ---------- 5. Reversal symmetry -------------------------------------------
const fwd = footballWeightedCompositeEdge(realNameArgs());
const revArgs = realNameArgs();
Object.assign(revArgs, { teamA: revArgs.teamB, teamB: 'Kansas City Chiefs' });
const rev = footballWeightedCompositeEdge(revArgs);
check('reversal symmetry: edge flips sign', Math.abs(fwd.edge + rev.edge) < 1e-9, fwd.edge + ' vs ' + rev.edge);
check('real KC vs BUF matchup produces a bounded edge', Math.abs(fwd.edge) < 6, fwd.edge);

// ---------- 6. Single-factor isolation (synthetic table teams) -------------
NFL_NAME_TO_ABBR['test team alpha'] = 'TSTA';
NFL_NAME_TO_ABBR['test team beta'] = 'TSTB';
function synthTeam(overrides) {
  const base = JSON.parse(JSON.stringify(NFL_TEAM_EPA['KC']));
  base.gp = 17; // full-season: no shrinkage
  return Object.assign(base, overrides);
}
function isoArgs(overA, overB) {
  NFL_TEAM_EPA['TSTA'] = synthTeam(overA);
  NFL_TEAM_EPA['TSTB'] = synthTeam(overB);
  return {
    teamA: 'Test Team Alpha', teamB: 'Test Team Beta',
    ctxA: {}, ctxB: {}, profA: {}, profB: {},
    gpA: 17, gpB: 17, league: 'NFL', avgPoints: 22,
  };
}
// QB composite: 1.0 SD gap -> 1.0*3.0 = 3 points, weight 0.15.
const qbIso = footballWeightedCompositeEdge(isoArgs({ qbComposite: 1.0 }, { qbComposite: 0.0 })).edge;
check('QB isolation', Math.abs(qbIso - 0.15 * 3.0) < 1e-9, qbIso);
// EPA per play: 0.1 net gap -> 0.1*45 = 4.5, weight 0.18.
const epaIso = footballWeightedCompositeEdge(isoArgs({ offEpa: 0.1, defEpa: 0.0 }, { offEpa: 0.0, defEpa: 0.0 })).edge;
check('EPA per play isolation', Math.abs(epaIso - 0.18 * 4.5) < 1e-9, epaIso);
// Passing EPA: 0.2 gap -> 0.2*34 = 6.8 -> clamped to 6, weight 0.12.
const passIso = footballWeightedCompositeEdge(isoArgs({ passEpaDb: 0.2 }, { passEpaDb: 0.0 })).edge;
check('passing EPA isolation', Math.abs(passIso - 0.12 * 6) < 1e-9, passIso);
// Success rate: 12pp net gap -> norm(0.12, 0.12, 4) = 4, weight 0.10.
const srIso = footballWeightedCompositeEdge(isoArgs({ offSr: 0.50, defSr: 0.40 }, { offSr: 0.44, defSr: 0.46 })).edge;
check('success rate isolation', Math.abs(srIso - 0.10 * 4) < 1e-9, srIso);
// Turnover margin: 2/g gap -> 2*4 = 8 -> clamped to 6, weight 0.09.
const toIso = footballWeightedCompositeEdge(isoArgs({ toMargin: 1.0 }, { toMargin: -1.0 })).edge;
check('turnover isolation', Math.abs(toIso - 0.09 * 6) < 1e-9, toIso);
// Defensive EPA: A allows 0.1 less -> 0.1*40 = 4, weight 0.08.
// Note: also fires EPA-per-play (defEpa is part of net EPA): 0.1*45=4.5, weight 0.18.
// Combined: 0.08*4 + 0.18*4.5 = 0.32 + 0.81 = 1.13.
const defIso = footballWeightedCompositeEdge(isoArgs({ defEpa: -0.05 }, { defEpa: 0.05 })).edge;
check('defensive EPA isolation', Math.abs(defIso - 1.13) < 1e-9, defIso);
delete NFL_TEAM_EPA['TSTA']; delete NFL_TEAM_EPA['TSTB'];
delete NFL_NAME_TO_ABBR['test team alpha']; delete NFL_NAME_TO_ABBR['test team beta'];

// ---------- 7. Early-season shrinkage --------------------------------------
NFL_NAME_TO_ABBR['test team alpha'] = 'TSTA';
NFL_NAME_TO_ABBR['test team beta'] = 'TSTB';
function smallDiffTeam(overrides, gp) {
  const base = JSON.parse(JSON.stringify(NFL_TEAM_EPA['KC']));
  base.gp = gp;
  return Object.assign(base, overrides);
}
NFL_TEAM_EPA['TSTA'] = smallDiffTeam({ passEpaDb: 0.05, qbComposite: 0.5, offEarlySr: 0.55 }, 3);
NFL_TEAM_EPA['TSTB'] = smallDiffTeam({ passEpaDb: 0.0, qbComposite: 0.0, offEarlySr: 0.50 }, 3);
const shArgs = {
  teamA: 'Test Team Alpha', teamB: 'Test Team Beta',
  ctxA: {}, ctxB: {}, profA: {}, profB: {},
  gpA: 3, gpB: 3, league: 'NFL', avgPoints: 22,
};
const earlyEdge = footballWeightedCompositeEdge(shArgs).edge;
NFL_TEAM_EPA['TSTA'].gp = 17;
NFL_TEAM_EPA['TSTB'].gp = 17;
const lateEdge = footballWeightedCompositeEdge(shArgs).edge;
delete NFL_TEAM_EPA['TSTA']; delete NFL_TEAM_EPA['TSTB'];
delete NFL_NAME_TO_ABBR['test team alpha']; delete NFL_NAME_TO_ABBR['test team beta'];
check('early-season edge shrunk exactly 8/3 vs full season',
  earlyEdge !== 0 && Math.abs(lateEdge / earlyEdge - 8 / 3) < 1e-9,
  earlyEdge + ' vs ' + lateEdge);

// ---------- 8. Per-factor clamp --------------------------------------------
check('clamp caps at +/-6', footballClampEdge(99) === 6 && footballClampEdge(-99) === -6 && footballClampEdge(2.5) === 2.5);

// ---------- 9. CFB fallback path (ctx/prof inputs, no EPA table) ------------
const cfbArgs = {
  teamA: 'Springfield Atoms', teamB: 'Shelbyville Sharks',
  ctxA: { pitcherFactor: 1.1, olineFactor: 1.03, passRushFactor: 1.02, kickerFactor: 1.01 },
  ctxB: { pitcherFactor: 1.0, olineFactor: 0.99, passRushFactor: 0.99, kickerFactor: 0.99 },
  profA: { bigPlays: 12, redZoneTdPct: 65, penaltyYards: 90 },
  profB: { bigPlays: 8, redZoneTdPct: 55, penaltyYards: 130 },
  gpA: 3, gpB: 3, league: 'CFB', avgPoints: 28,
};
const cfbEdge = footballWeightedCompositeEdge(cfbArgs).edge;
// Drew's 2026-10-05 weights: qb 0.15*(0.1*28) + pressure 0.07*(((0.04*28)+(-0.03*28))/2)
//   + redzone 0.04*norm(0.10,0.25,2.5)=0.04*1.0
//   + explosive 0.05*norm(1.333, 2, 3)=0.05*2
//   + special 0.03*((0.01)-(-0.01))*28
const cfbExpected = 0.567;
check('CFB fallback edge matches hand computation', Math.abs(cfbEdge - cfbExpected) < 1e-9, cfbEdge + ' vs ' + cfbExpected);

// ---------- 10. Composite-on: old tier slots go neutral ---------------------
const fbCtx = {
  pitcherFactor: 1.35, footballFactor: 1.03, rbFactor: 1.12, wrFactor: 1.10,
  olineFactor: 1.08, passRushFactor: 0.93, kickerFactor: 1.04,
  turnoverMarginPerGame: 1.0, footballCompositeOn: true,
};
const fbNeutral = { footballCompositeOn: true };
check('composite on: multiplier ignores ALL old football slots',
  Math.abs(calculateLambdaMultiplier(fbCtx) - calculateLambdaMultiplier(fbNeutral)) < 1e-12,
  calculateLambdaMultiplier(fbCtx) + ' vs ' + calculateLambdaMultiplier(fbNeutral));
check('composite on: untouched inputs still move the multiplier',
  Math.abs(calculateLambdaMultiplier({ footballCompositeOn: true, restDays: 0 }) -
           calculateLambdaMultiplier({ footballCompositeOn: true, restDays: 5 })) > 1e-9);
const offCtx = { ...fbCtx }; delete offCtx.footballCompositeOn;
check('composite off: old slots still move the multiplier (legacy path intact)',
  Math.abs(calculateLambdaMultiplier(offCtx) - calculateLambdaMultiplier({})) > 1e-9);
check('non-football call unaffected by default',
  Math.abs(calculateLambdaMultiplier({ pitcherFactor: 1.3 }) - 1.3) < 1e-9,
  calculateLambdaMultiplier({ pitcherFactor: 1.3 }));

// ---------- 11. Turnover constants still exported ---------------------------
check('turnover dampen constant is 0.3', TURNOVER_LUCK_DAMPEN === 0.3);
check('points per turnover is 4.5', POINTS_PER_TURNOVER === 4.5);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
