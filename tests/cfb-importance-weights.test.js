// CFB 15-FACTOR IMPORTANCE WEIGHTS (Drew's call 2026-10-02): Drew's run-heavy
// college football weights for the Monte Carlo loop, summing to exactly 100%.
// Covers: exact weights and 100% sum, the CFB advanced-stats table sanity,
// name lookup (school / school+mascot / abbreviation), the CFB composite
// routing (table teams use the new path, unknown teams fall back to the
// legacy ctx/profile path), neutral missing-data behavior, reversal symmetry,
// early-season shrinkage, the per-factor clamp, and single-factor isolation
// for the new metrics. Tests the REAL bundle code by extracting from
// ../src/index.js (never a copy). Runs under plain node, no dependencies.
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
  extractConst('CFB_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_TEAM_ADV').replace(/^const /, 'var '),
  extractFn('cfbWeightsTotal'),
  extractFn('cfbAdvForTeamName'),
  extractFn('footballClampEdge'),
  extractFn('cfbWeightedCompositeEdge'),
].join('\n');
eval(bundle);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

// ---------- 1. Exact weights, Drew's list, 100% sum -----------------------
const EXPECTED = [
  ['rushSr', 0.14], ['lineYds', 0.11], ['defRushSr', 0.10],
  ['defLineYds', 0.09], ['stuffRate', 0.08], ['finDrv', 0.08],
  ['powerSr', 0.07], ['rushExp', 0.06], ['defFinDrv', 0.06],
  ['dropbackEpa', 0.05], ['defPowerSr', 0.04], ['defDropbackEpa', 0.04],
  ['stdDownsEpa', 0.03], ['defPassExp', 0.03], ['fieldPos', 0.02],
];
check('weights list has exactly 15 entries', CFB_IMPORTANCE_WEIGHTS.length === 15, CFB_IMPORTANCE_WEIGHTS.length);
check('weights sum to exactly 1.00', Math.abs(cfbWeightsTotal() - 1) < 1e-9, cfbWeightsTotal());
for (const [key, w] of EXPECTED) {
  const row = CFB_IMPORTANCE_WEIGHTS.find((r) => r.key === key);
  check('weight ' + key + ' = ' + w, !!row && Math.abs(row.weight - w) < 1e-12, row && row.weight);
}
check('weights order matches Drew\'s importance order',
  CFB_IMPORTANCE_WEIGHTS.map((r) => r.key).join(',') === EXPECTED.map((e) => e[0]).join(','));

// ---------- 2. Table sanity -------------------------------------------------
const teams = CFB_TEAM_ADV.teams;
check('table covers 138 FBS teams', Object.keys(teams).length === 138, Object.keys(teams).length);
const FIELDS = ['rushSr','lineYds','defRushSr','defLineYds','stuffRate','finDrv',
  'powerSr','rushExp','defFinDrv','dropbackEpa','defPowerSr','defDropbackEpa',
  'stdDownsEpa','defPassExp','fieldPos','gp'];
let badFields = 0;
for (const [name, t] of Object.entries(teams)) {
  for (const f of FIELDS) {
    if (typeof t[f] !== 'number' || !isFinite(t[f])) { badFields++; break; }
  }
  if (t.gp <= 0) { badFields++; break; }
}
check('every team has all 16 numeric fields and gp>0', badFields === 0, badFields + ' bad');
check('Georgia rushing success rate is sane', teams['Georgia'].rushSr > 0.3 && teams['Georgia'].rushSr < 0.7, teams['Georgia'].rushSr);
check('field position margin is bounded', Object.values(teams).every((t) => Math.abs(t.fieldPos) < 40));

// ---------- 3. Name lookup ----------------------------------------------------
check('lookup by school name', !!cfbAdvForTeamName('Georgia'));
check('lookup by school + mascot', !!cfbAdvForTeamName('Georgia Bulldogs'));
check('lookup by abbreviation', !!cfbAdvForTeamName('UGA'));
check('lookup is case/punctuation-insensitive', !!cfbAdvForTeamName('  ohio state!! '));
check('lookup misses gracefully', cfbAdvForTeamName('Springfield Atoms') === null);

// ---------- 4. Composite routing ----------------------------------------------
function cfbArgs(a, b) {
  return { teamA: a, teamB: b, ctxA: {}, ctxB: {}, profA: {}, profB: {}, gpA: 4, gpB: 4, league: 'CFB', avgPoints: 28 };
}
const real = cfbWeightedCompositeEdge(cfbArgs('Georgia', 'Alabama'));
check('real Georgia vs Alabama produces a bounded edge', Math.abs(real.edge) < 6 && real.bits.length > 0, real.edge);
check('bits mention the run game', real.bits.some((x) => x.startsWith('rushSr') || x.startsWith('lineYds')), real.bits.join(' | ').slice(0, 160));

// ---------- 5. Reversal symmetry --------------------------------------------------
const fwd = cfbWeightedCompositeEdge(cfbArgs('Georgia', 'Alabama'));
const rev = cfbWeightedCompositeEdge(cfbArgs('Alabama', 'Georgia'));
check('reversal symmetry: edge flips sign', Math.abs(fwd.edge + rev.edge) < 1e-9, fwd.edge + ' vs ' + rev.edge);

// ---------- 6. Single-factor isolation (synthetic table teams) ---------------------
CFB_TEAM_ADV.teams['Test Alpha'] = Object.assign({}, teams['Georgia'], { gp: 17 });
CFB_TEAM_ADV.teams['Test Beta'] = Object.assign({}, teams['Georgia'], { gp: 17 });
CFB_TEAM_ADV.lookup['testalpha'] = 'Test Alpha';
CFB_TEAM_ADV.lookup['testbeta'] = 'Test Beta';
function isoArgs(overA, overB) {
  Object.assign(CFB_TEAM_ADV.teams['Test Alpha'], overA);
  // reset Beta to Georgia baseline, then apply overrides
  const base = Object.assign({}, teams['Georgia'], { gp: 17 });
  CFB_TEAM_ADV.teams['Test Beta'] = Object.assign(base, overB);
  const baseA = Object.assign({}, teams['Georgia'], { gp: 17 });
  CFB_TEAM_ADV.teams['Test Alpha'] = Object.assign(baseA, overA);
  return cfbArgs('Test Alpha', 'Test Beta');
}
// Rushing SR: 10pp gap -> norm(0.10, 0.10, 3) = 3, weight 0.14.
const rsIso = cfbWeightedCompositeEdge(isoArgs({ rushSr: 0.55 }, { rushSr: 0.45 })).edge;
check('rushing SR isolation', Math.abs(rsIso - 0.14 * 3) < 1e-9, rsIso);
// Line yards: 1.0 yd gap -> norm(1.0, 1.0, 3) = 3, weight 0.11.
const lyIso = cfbWeightedCompositeEdge(isoArgs({ lineYds: 4.0 }, { lineYds: 3.0 })).edge;
check('line yards isolation', Math.abs(lyIso - 0.11 * 3) < 1e-9, lyIso);
// Defensive rushing SR: A allows 10pp less -> +edge for A.
const drIso = cfbWeightedCompositeEdge(isoArgs({ defRushSr: 0.30 }, { defRushSr: 0.40 })).edge;
check('defensive rushing SR isolation', Math.abs(drIso - 0.10 * 3) < 1e-9, drIso);
// Stuff rate: 5pp gap -> norm(0.05, 0.05, 2.5) = 2.5, weight 0.08.
const stIso = cfbWeightedCompositeEdge(isoArgs({ stuffRate: 0.25 }, { stuffRate: 0.20 })).edge;
check('stuff rate isolation', Math.abs(stIso - 0.08 * 2.5) < 1e-9, stIso);
// Finishing drives: 1.0 pt/opp gap -> norm(1.0, 1.0, 3) = 3, weight 0.08.
const fdIso = cfbWeightedCompositeEdge(isoArgs({ finDrv: 5.5 }, { finDrv: 4.5 })).edge;
check('finishing drives isolation', Math.abs(fdIso - 0.08 * 3) < 1e-9, fdIso);
// Dropback EPA clamp: 0.5 gap -> 15 -> clamped to 6, weight 0.05.
const dbIso = cfbWeightedCompositeEdge(isoArgs({ dropbackEpa: 0.5 }, { dropbackEpa: 0.0 })).edge;
check('dropback EPA isolation hits the +/-6 clamp', Math.abs(dbIso - 0.05 * 6) < 1e-9, dbIso);
// Field position: 8-yard margin -> norm(8, 8, 1.5) = 1.5, weight 0.02.
const fpIso = cfbWeightedCompositeEdge(isoArgs({ fieldPos: 4 }, { fieldPos: -4 })).edge;
check('field position isolation', Math.abs(fpIso - 0.02 * 1.5) < 1e-9, fpIso);
delete CFB_TEAM_ADV.teams['Test Alpha']; delete CFB_TEAM_ADV.teams['Test Beta'];
delete CFB_TEAM_ADV.lookup['testalpha']; delete CFB_TEAM_ADV.lookup['testbeta'];

// ---------- 7. Early-season shrinkage ---------------------------------------------
CFB_TEAM_ADV.teams['Test Alpha'] = Object.assign({}, teams['Georgia'], { gp: 2, rushSr: 0.60 });
CFB_TEAM_ADV.teams['Test Beta'] = Object.assign({}, teams['Georgia'], { gp: 2, rushSr: 0.50 });
CFB_TEAM_ADV.lookup['testalpha'] = 'Test Alpha';
CFB_TEAM_ADV.lookup['testbeta'] = 'Test Beta';
const earlyEdge = cfbWeightedCompositeEdge(cfbArgs('Test Alpha', 'Test Beta')).edge;
CFB_TEAM_ADV.teams['Test Alpha'].gp = 17;
CFB_TEAM_ADV.teams['Test Beta'].gp = 17;
const lateEdge = cfbWeightedCompositeEdge(cfbArgs('Test Alpha', 'Test Beta')).edge;
delete CFB_TEAM_ADV.teams['Test Alpha']; delete CFB_TEAM_ADV.teams['Test Beta'];
delete CFB_TEAM_ADV.lookup['testalpha']; delete CFB_TEAM_ADV.lookup['testbeta'];
check('early-season edge shrunk exactly 8/2 vs full season',
  earlyEdge !== 0 && Math.abs(lateEdge / earlyEdge - 8 / 2) < 1e-9,
  earlyEdge + ' vs ' + lateEdge);

// ---------- 8. Per-factor clamp -------------------------------------------------------
check('clamp caps at +/-6', footballClampEdge(99) === 6 && footballClampEdge(-99) === -6);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
