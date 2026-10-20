// NHL IMPORTANCE WEIGHTS (Drew's call 2026-10-01): the 8-factor weighted
// composite for NHL. Covers: Drew's exact weights and 100% sum, neutral
// missing-data behavior (no fabricated defaults), reversal symmetry,
// early-season shrinkage, the per-factor clamp, the GSAx double-count guard
// (both starters must resolve or the legacy goalie slot stays), controlled
// transitions staying neutral, bridgeToTeamSim applying +/- E/2 only for NHL
// with the realistic lambda clamp, and unrelated sports staying untouched.
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

// Bundler name-helpers referenced inside extracted functions — stub as identity.
for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  globalThis[n] = (f) => f;
}

const bundle = [
  extractConst('NHL_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('NHL_NAME_TO_ABBR').replace(/^const /, 'var '),
  extractConst('NHL_MONEYPUCK').replace(/^const /, 'var '),
  extractConst('LEAGUE_AVERAGE_FALLBACKS').replace(/^var /, 'var '),
  extractFn('nhlWeightsTotal'),
  extractFn('nhlAbbrForTeamName'),
  extractFn('nhlMoneypuckForTeamName'),
  extractFn('nhlGsaxForGoalie'),
  extractFn('nhlClampEdge'),
  extractFn('nhlWeightedCompositeEdge'),
].join('\n');
eval(bundle);

// Swap the embedded table for scenario tests by assigning to the existing
// var binding (the extracted functions close over it).
function swapTable(mutator) {
  const saved = NHL_MONEYPUCK;
  const wild = JSON.parse(JSON.stringify(saved));
  mutator(wild);
  eval('NHL_MONEYPUCK = ' + JSON.stringify(wild) + ';');
  return saved;
}
function restoreTable(saved) {
  eval('NHL_MONEYPUCK = ' + JSON.stringify(saved) + ';');
}

// ---- stubs for the bridge test ----
globalThis.normalizeLeague = (l) => String(l || '').toUpperCase();
globalThis.isFootballLeague = (l) => l === 'NFL' || l === 'CFB';
globalThis.calculateLambdaMultiplier = () => 1;
globalThis.clampFootballLambda = (x) => x;
globalThis.footballBounds = () => ({ maxLambda: 40 });
eval(extractFn('bridgeToTeamSim'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name, extra === undefined ? '' : extra); }
}

// Goalies known to exist in the table with matching teams.
const GA = 'Igor Shesterkin', TA = 'New York Rangers';       // NYR
const GB = 'Ilya Sorokin',    TB = 'New York Islanders';     // NYI

// 1. Drew's exact weights, 100% total.
const wmap = {};
for (const w of NHL_IMPORTANCE_WEIGHTS) wmap[w.key] = w.weight;
check('xgf 25%', wmap.xgf === 0.25, wmap.xgf);
check('gsax 20%', wmap.gsax === 0.20, wmap.gsax);
check('hdcf 15%', wmap.hdcf === 0.15, wmap.hdcf);
check('corsi 10%', wmap.corsi === 0.10, wmap.corsi);
check('p60 (5v5 P/60) 10%', wmap.p60 === 0.10, wmap.p60);
check('ixg 8%', wmap.ixg === 0.08, wmap.ixg);
check('trans 7%', wmap.trans === 0.07, wmap.trans);
check('pdo 5%', wmap.pdo === 0.05, wmap.pdo);
check('weights sum to 100%', Math.abs(nhlWeightsTotal() - 1.0) < 1e-9, nhlWeightsTotal());
check('8 factors', NHL_IMPORTANCE_WEIGHTS.length === 8);

// 2. Team lookup works; unknown team -> null.
check('NYR resolves', !!nhlMoneypuckForTeamName(TA));
check('NYI resolves', !!nhlMoneypuckForTeamName(TB));
check('unknown team null', nhlMoneypuckForTeamName('Springfield Isotopes') === null);

// 3. Missing-data neutrality: unknown teams -> edge exactly 0, no bits.
{
  const c = nhlWeightedCompositeEdge({ teamA: 'Springfield Isotopes', teamB: 'Shelbyville Sharks' });
  check('unknown teams edge 0', c.edge === 0, c.edge);
  check('unknown teams no bits', c.bits.length === 0);
  check('unknown teams gsax flags false', c.gsaxUsedA === false && c.gsaxUsedB === false);
}
{
  // One side known, other missing -> neutral (shrinkage min() -> 0).
  const c = nhlWeightedCompositeEdge({ teamA: TA, teamB: 'Springfield Isotopes' });
  check('one-sided missing edge 0', c.edge === 0, c.edge);
}

// 4. Reversal symmetry.
{
  const fwd = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  const rev = nhlWeightedCompositeEdge({ teamA: TB, teamB: TA, goalieA: GB, goalieB: GA });
  check('reversal symmetry', Math.abs(fwd.edge + rev.edge) < 1e-9, [fwd.edge, rev.edge]);
}

// 5. Early-season shrinkage: the real table is 1-gp; inflating gp must move
// the edge MORE (same differentials, less shrinkage).
{
  const thin = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  const saved = swapTable((big) => {
    for (const tm of Object.values(big.teams)) tm.gp = 20;
    for (const g of big.goalies) g.gp = 12;
  });
  const full = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  restoreTable(saved);
  check('shrinkage damps thin samples', Math.abs(full.edge) >= Math.abs(thin.edge) - 1e-9,
    [thin.edge, full.edge]);
  check('thin-sample shrink factor reported', thin.shrink <= 0.15 + 1e-9, thin.shrink);
}

// 6. Per-factor clamp bounds the edge even with absurd inputs.
{
  const saved = swapTable((wild) => {
    wild.teams.NYR = { gp: 20, xgf_pct: 0.95, cf_pct: 0.95, ff_pct: 0.95, hdcf_pct: 0.99,
      p60: 12.0, ixg60: 8.0, prim60: 9.0, pdo: 1.40, toi_min: 1100 };
    wild.teams.NYI = { gp: 20, xgf_pct: 0.05, cf_pct: 0.05, ff_pct: 0.05, hdcf_pct: 0.01,
      p60: 1.0, ixg60: 0.1, prim60: 0.5, pdo: 0.60, toi_min: 1100 };
    wild.goalies = [{ name: 'igor shesterkin', team: 'NYR', gp: 12, gsax_pg: 3.0 },
                    { name: 'ilya sorokin', team: 'NYI', gp: 12, gsax_pg: -3.0 }];
  });
  const c = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  restoreTable(saved);
  // Max theoretical: .75*.25+.75*.20+.6*.15+.5*.10+.5*.10+.4*.08+.4*.05 = 0.5795
  check('edge bounded by clamps', Math.abs(c.edge) <= 0.58 + 1e-9, c.edge);
  check('extreme edge positive', c.edge > 0.3, c.edge);
}

// 6b. Chance creation blends iXG/60 AND primary points/60: with iXG equal,
// a prim60 gap alone must still move the edge.
{
  const saved = swapTable((wild) => {
    wild.teams.NYR = { gp: 20, xgf_pct: 0.5, cf_pct: 0.5, ff_pct: 0.5, hdcf_pct: 0.5,
      p60: 6.0, ixg60: 2.5, prim60: 9.0, pdo: 1.0, toi_min: 1100 };
    wild.teams.NYI = { gp: 20, xgf_pct: 0.5, cf_pct: 0.5, ff_pct: 0.5, hdcf_pct: 0.5,
      p60: 6.0, ixg60: 2.5, prim60: 3.0, pdo: 1.0, toi_min: 1100 };
    wild.goalies = [];
  });
  const c = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB });
  restoreTable(saved);
  // Only the chance-creation factor differs: 0.08 * clamp((9-3)*0.30*0.5, 0.40)
  // = 0.08 * 0.40 = 0.032, unshrunk (gp 20).
  check('primary points move the edge', Math.abs(c.edge - 0.032) < 1e-9, c.edge);
}

// 7. GSAx double-count guard: both starters must resolve.
{
  const both = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  check('both goalies known -> flags true', both.gsaxUsedA === true && both.gsaxUsedB === true,
    [both.gsaxUsedA, both.gsaxUsedB]);
  const one = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: 'Nobody Nobody' });
  check('one goalie unknown -> flags false', one.gsaxUsedA === false && one.gsaxUsedB === false);
  const none = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB });
  check('no goalies -> flags false', none.gsaxUsedA === false && none.gsaxUsedB === false);
}

// 8. Controlled transitions (7%) contribute nothing.
{
  const c = nhlWeightedCompositeEdge({ teamA: TA, teamB: TB, goalieA: GA, goalieB: GB });
  const hasTrans = c.bits.some((b) => /transition/i.test(b));
  check('transitions neutral (no bit, no fabrication)', hasTrans === false, c.bits);
}

// 9. bridgeToTeamSim: NHL applies +/- E/2 with realistic clamp; others untouched.
{
  const r = bridgeToTeamSim({ offenseA: 3.1, defenseA: 3.1, offenseB: 3.1, defenseB: 3.1,
    league: 'NHL', contextA: { nhlEdgeGoals: 0.4 }, contextB: { nhlEdgeGoals: -0.4 } });
  // baseLambda = 3.1*3.1/3.1 = 3.1; +0.4 -> 3.5 / -0.4 -> 2.7
  check('NHL edge applied A', Math.abs(r.lambdaA - 3.5) < 1e-9, r.lambdaA);
  check('NHL edge applied B', Math.abs(r.lambdaB - 2.7) < 1e-9, r.lambdaB);
}
{
  // Absurd edge gets clamped into [1.0, 6.0].
  const r = bridgeToTeamSim({ offenseA: 3.1, defenseA: 3.1, offenseB: 3.1, defenseB: 3.1,
    league: 'NHL', contextA: { nhlEdgeGoals: 99 }, contextB: { nhlEdgeGoals: -99 } });
  check('NHL lambda clamped high', r.lambdaA <= 6.0 + 1e-9, r.lambdaA);
  check('NHL lambda clamped low', r.lambdaB >= 1.0 - 1e-9, r.lambdaB);
}
{
  // No edge set -> base lambdas, no crash.
  const r = bridgeToTeamSim({ offenseA: 3.1, defenseA: 3.1, offenseB: 3.1, defenseB: 3.1,
    league: 'NHL', contextA: {}, contextB: {} });
  check('NHL no-edge passthrough', Math.abs(r.lambdaA - 3.1) < 1e-9 && Math.abs(r.lambdaB - 3.1) < 1e-9,
    [r.lambdaA, r.lambdaB]);
}
{
  // MLB path ignores nhlEdgeGoals entirely.
  const r = bridgeToTeamSim({ offenseA: 4.5, defenseA: 4.5, offenseB: 4.5, defenseB: 4.5,
    league: 'MLB', contextA: { nhlEdgeGoals: 99 }, contextB: { nhlEdgeGoals: -99 } });
  check('MLB ignores NHL edge', Math.abs(r.lambdaA - 4.5) < 1e-9 && Math.abs(r.lambdaB - 4.5) < 1e-9,
    [r.lambdaA, r.lambdaB]);
}
{
  // HFA still stacks for NHL.
  const r = bridgeToTeamSim({ offenseA: 3.1, defenseA: 3.1, offenseB: 3.1, defenseB: 3.1,
    league: 'NHL', contextA: { nhlEdgeGoals: 0, homeFieldPts: 0.25 }, contextB: {} });
  check('NHL HFA preserved', Math.abs(r.lambdaA - 3.35) < 1e-9, r.lambdaA);
}

// 10. nhlClampEdge bound.
check('clamp bound', nhlClampEdge(5) === 0.75 && nhlClampEdge(-5) === -0.75 && nhlClampEdge(0.2) === 0.2);

// 11. All 32 teams mapped.
check('32 teams mapped', Object.keys(NHL_NAME_TO_ABBR).length === 32,
  Object.keys(NHL_NAME_TO_ABBR).length);

console.log(`nhl-importance-weights: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
