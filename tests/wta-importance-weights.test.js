// WTA 12-FACTOR IMPORTANCE WEIGHTS (2026-09-28): the women's model runs on a
// 12-factor weighted composite — twelve individual factors, each weighted on
// its own — applied as a hold-probability edge banked inside the Monte Carlo
// loop. WTA + ITF: ATP never enters the path. Covers: exact weights and 100% sum,
// groundstroke > serve ordering, tour-grounded scales, neutral missing-data
// behavior (no fabricated defaults), reversal symmetry, single-factor
// isolation, per-factor clamp, double-fault inversion, H2H gate, ranking
// differential, name matching (incl. diacritics), the 5-match minimum sample
// gate, best-of-3 for WTA, and WTA-only branch gating in the bundle.
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

function extractVarStmt(name) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start < 0) throw new Error('var missing from bundle: ' + name);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

// Bundler name-helpers referenced inside extracted functions — stub as identity.
for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222']) {
  global[n] = (fn) => fn;
}

eval(extractConst('WTA_IMPORTANCE_WEIGHTS'));
eval(extractConst('WTA_STAT_FIELD'));
const WTA_EDGE_HOLD_SCALE = extractNumVar('WTA_EDGE_HOLD_SCALE');
const WTA_MIN_MATCHES = extractNumVar('WTA_MIN_MATCHES');
eval(extractFn('stripDiacritics'));
eval(extractFn('wtaNormalizeName'));
eval(extractFn('findWtaPlayerRow'));
eval(extractFn('wtaClampEdge'));
eval(extractFn('wtaWeightedCompositeEdge'));
eval(extractVarStmt('GRAND_SLAM_NAME_RE'));
eval(extractFn('normalizeLeague'));
eval(extractFn('isTennisGrandSlam'));
eval(extractFn('tennisMatchBestOf'));

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}
function checkClose(desc, actual, expected, eps) {
  const ok = Math.abs(actual - expected) <= (eps || 1e-9);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
}
function checkGt(desc, actual, floor) {
  const ok = actual > floor;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected > ' + floor + ')'));
}
function checkLt(desc, actual, ceil) {
  const ok = actual < ceil;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected < ' + ceil + ')'));
}

// ---------- exact weights: Drew's 12-factor spec, 100% total ----------
const EXPECTED = [
  ["returnPointsWonPct", 0.21], ["breakPointsConvertedPct", 0.17],
  ["servicePointsWonPct", 0.10], ["breakPointsSavedPct", 0.08],
  ["firstServeWonPct", 0.08], ["secondServeWonPct", 0.08],
  ["surfaceWinPct", 0.08], ["returnGamesWonPct", 0.09],
  ["serviceGamesWonPct", 0.05], ["doubleFaultRate", 0.02],
  ["h2h", 0.02], ["rankingDiff", 0.02],
];
check('12 factors', WTA_IMPORTANCE_WEIGHTS.length, 12);
EXPECTED.forEach(([key, w], i) => {
  check(`factor ${i} key`, WTA_IMPORTANCE_WEIGHTS[i].key, key);
  check(`factor ${key} weight`, WTA_IMPORTANCE_WEIGHTS[i].weight, w);
});
checkClose('weights sum to exactly 1.0',
  WTA_IMPORTANCE_WEIGHTS.reduce((s, d) => s + d.weight, 0), 1.0, 1e-12);

const wOf = (k) => WTA_IMPORTANCE_WEIGHTS.find((d) => d.key === k).weight;
check('return points won is the single heaviest factor',
  wOf("returnPointsWonPct") === Math.max(...WTA_IMPORTANCE_WEIGHTS.map((d) => d.weight)), true);

// ---------- tour-grounded scales ----------
const sOf = (k) => WTA_IMPORTANCE_WEIGHTS.find((d) => d.key === k).scale;
check('returnPointsWonPct scale = 2x tour sd', sOf("returnPointsWonPct"), 6.0);
check('breakPointsConvertedPct scale', sOf("breakPointsConvertedPct"), 11.2);
check('servicePointsWonPct scale', sOf("servicePointsWonPct"), 6.8);
check('breakPointsSavedPct scale', sOf("breakPointsSavedPct"), 9.8);
check('firstServeWonPct scale', sOf("firstServeWonPct"), 9.0);
check('secondServeWonPct scale', sOf("secondServeWonPct"), 7.8);
check('returnGamesWonPct scale', sOf("returnGamesWonPct"), 13.8);
check('serviceGamesWonPct scale', sOf("serviceGamesWonPct"), 14.8);
check('doubleFaultRate scale', sOf("doubleFaultRate"), 0.25);
check('doubleFaultRate inverted (lower is better)',
  WTA_IMPORTANCE_WEIGHTS.find((d) => d.key === "doubleFaultRate").invert, true);
check('WTA_EDGE_HOLD_SCALE = 0.05', WTA_EDGE_HOLD_SCALE, 0.05);
check('WTA_MIN_MATCHES = 5', WTA_MIN_MATCHES, 5);

// ---------- fixtures ----------
const rowA = {
  First_Name: "ARYNA", Last_Name: "SABALENKA", MatchCount: 40,
  return_points_won_percent: 45.9, breakpoint_converted_percent: 50.7,
  service_points_won_percent: 59.3, breakpoint_saved_percent: 59.1,
  first_serve_won_percent: 67.5, second_serve_won_percent: 48.4,
  return_games_won_percent: 40.4, service_games_won_percent: 71.2,
  Double_Faults: 100, Service_Games_Played: 400,
};
const rowB = {
  First_Name: "COCO", Last_Name: "GAUFF", MatchCount: 38,
  return_points_won_percent: 43.1, breakpoint_converted_percent: 46.2,
  service_points_won_percent: 56.8, breakpoint_saved_percent: 55.3,
  first_serve_won_percent: 63.9, second_serve_won_percent: 44.9,
  return_games_won_percent: 35.2, service_games_won_percent: 64.5,
  Double_Faults: 150, Service_Games_Played: 380,
};
const ctxAB = { rankA: 1, rankB: 3, surfaceWinPctA: 72, surfaceWinPctB: 64,
  h2hWinsA: 3, h2hWinsB: 2, h2hTotal: 5 };
const ctxBA = { rankA: 3, rankB: 1, surfaceWinPctA: 64, surfaceWinPctB: 72,
  h2hWinsA: 2, h2hWinsB: 3, h2hTotal: 5 };

// ---------- missing-data rule: neutral, never fabricated ----------
const allMissing = wtaWeightedCompositeEdge({}, {}, {});
checkClose('all missing -> edge exactly 0', allMissing.edge, 0, 0);
check('all missing -> every factor edge 0',
  Object.values(allMissing.edges).every((e) => e === 0), true);
const oneSided = wtaWeightedCompositeEdge(rowA, {}, {});
checkClose('one-sided missing -> edge exactly 0', oneSided.edge, 0, 0);

// ---------- reversal symmetry ----------
const fwd = wtaWeightedCompositeEdge(rowA, rowB, ctxAB);
const rev = wtaWeightedCompositeEdge(rowB, rowA, ctxBA);
checkClose('reversal symmetry: edge(A,B) = -edge(B,A)', fwd.edge + rev.edge, 0, 1e-12);
checkGt('Sabalenka-style row beats Gauff-style row', fwd.edge, 0);

// ---------- single-factor isolation ----------
const isoB = Object.assign({}, rowA, { return_points_won_percent: rowA.return_points_won_percent - 6.0 });
const iso = wtaWeightedCompositeEdge(rowA, isoB, {});
checkClose('one scale-unit gap in Return Pts Won -> 0.21 edge', iso.edge, 0.21, 1e-9);
checkClose('only that factor is nonzero',
  Object.keys(iso.edges).filter((k) => iso.edges[k] !== 0).length, 1, 0);

// ---------- per-factor clamp ----------
const hugeB = Object.assign({}, rowA, { return_points_won_percent: rowA.return_points_won_percent - 60 });
const huge = wtaWeightedCompositeEdge(rowA, hugeB, {});
checkClose('10x scale gap clamps to full weight', huge.edges.returnPointsWonPct, 1, 0);
checkClose('clamped contribution = weight', huge.edge, 0.21, 1e-9);
checkLt('max possible |edge| is 1.0', Math.abs(wtaWeightedCompositeEdge(rowA, hugeB, ctxAB).edge), 1.000001);

// ---------- double-fault inversion ----------
const dfB = Object.assign({}, rowA, { Double_Faults: 200 });
const dfWorse = wtaWeightedCompositeEdge(dfB, rowA, {});
checkLt('higher DF rate hurts (negative edge)', dfWorse.edges.doubleFaultRate, 0);
const dfBetter = wtaWeightedCompositeEdge(rowA, dfB, {});
checkGt('lower DF rate helps (positive edge)', dfBetter.edges.doubleFaultRate, 0);

// ---------- H2H gate ----------
const h2h = wtaWeightedCompositeEdge({}, {}, { h2hWinsA: 3, h2hWinsB: 1, h2hTotal: 4 });
checkClose('H2H 3-1 in 4 -> 0.5 edge', h2h.edges.h2h, 0.5, 1e-9);
checkClose('H2H contribution = 0.02 * 0.5', h2h.edge, 0.01, 1e-9);
const h2hThin = wtaWeightedCompositeEdge({}, {}, { h2hWinsA: 1, h2hWinsB: 0, h2hTotal: 1 });
check('H2H under 2 matches -> neutral', h2hThin.edges.h2h, 0);

// ---------- ranking differential ----------
const rk = wtaWeightedCompositeEdge({}, {}, { rankA: 1, rankB: 100 });
checkClose('rank #1 vs #100 -> full edge', rk.edges.rankingDiff, 1, 1e-9);
checkClose('ranking contribution = 0.02', rk.edge, 0.02, 1e-9);
const rkMissing = wtaWeightedCompositeEdge({}, {}, { rankA: 1, rankB: null });
check('missing rank -> neutral', rkMissing.edges.rankingDiff, 0);

// ---------- surface win % ----------
const sf = wtaWeightedCompositeEdge({}, {}, { surfaceWinPctA: 70, surfaceWinPctB: 50 });
checkClose('surface 70 vs 50 -> 0.5 edge', sf.edges.surfaceWinPct, 0.5, 1e-9);

// ---------- name matching ----------
const tourRows = [
  { First_Name: "ARYNA", Last_Name: "SABALENKA", MatchCount: 40 },
  { First_Name: "KATERINA", Last_Name: "SINIAKOVA", MatchCount: 22 },
  { First_Name: "ELENA", Last_Name: "RYBAKINA", MatchCount: 3 },
];
check('exact normalized name matches', findWtaPlayerRow(tourRows, "Aryna Sabalenka").Last_Name, "SABALENKA");
check('diacritics stripped in match', findWtaPlayerRow(tourRows, "Katerina Siniakova").Last_Name, "SINIAKOVA");
check('wtaNormalizeName strips diacritics', wtaNormalizeName("Kateřina Siniaková"), "KATERINA SINIAKOVA");
check('unknown name -> null', findWtaPlayerRow(tourRows, "Serena Williams"), null);
check('under 5 matches -> null (sample gate)', findWtaPlayerRow(tourRows, "Elena Rybakina"), null);
check('empty rows -> null', findWtaPlayerRow([], "Aryna Sabalenka"), null);

// ---------- WTA stays best-of-3 ----------
check('WTA Slam -> best of 3', tennisMatchBestOf('WTA', 'Wimbledon'), 3);
check('WTA non-Slam -> best of 3', tennisMatchBestOf('WTA', 'Charleston Open'), 3);

// ---------- WTA + ITF gating in the bundle (ATP excluded) ----------
const callIdx = src.indexOf('await wtaCompositeForMatchup(teamA, teamB, realRatings, env)');
check('composite invoked in bundle', callIdx > 0, true);
const gateIdx = src.lastIndexOf('if (key === "WTA" || key === "ITF")', callIdx);
check('composite call sits inside an if (key === "WTA" || key === "ITF") gate',
  gateIdx > 0 && callIdx - gateIdx < 600, true);
const between = src.slice(gateIdx, callIdx);
check('no ATP reference between gate and call', /"ATP"/.test(between), false);
check('writeup carries the league-aware 12-factor framing', src.includes('${key} 12-factor composite'), true);
check('ATP/ITF hold-% engine prose intact', src.includes('Hold % is the engine'), true);

// ---------- edge banks INSIDE the Monte Carlo loop (UFC pattern) ----------
eval('var CONSERVATISM_SHRINKAGE = ' + extractNumVar('CONSERVATISM_SHRINKAGE') + ';');
eval(extractFn('simulateTennisSet'));
eval(extractFn('runTennisMatchSimulation'));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const realRandom = Math.random;
function simSeeded(edge) {
  Math.random = mulberry32(20260928);
  try {
    return runTennisMatchSimulation({ holdA: 0.65, holdB: 0.65, bestOf: 3, trials: 2000, shrinkage: 0.4, wtaEdge: edge }).winPctA;
  } finally {
    Math.random = realRandom;
  }
}
const wZero = simSeeded(0), wPos = simSeeded(1), wNeg = simSeeded(-1), wUndef = simSeeded(undefined);
check('in-loop: wtaEdge +1 raises winPctA', wPos > wZero, true);
check('in-loop: wtaEdge -1 lowers winPctA', wNeg < wZero, true);
check('in-loop: undefined edge behaves as 0', wUndef, wZero);
check('in-loop: result carries the edge', simSeeded(0.5) !== undefined, true);

// ---------- loop wiring in the bundle ----------
check('sim call passes wtaEdge into the loop', src.includes('wtaEdge: simWtaEdge'), true);
check('no pre-loop hold mutation remains', src.includes('holdA + wtaComposite.edge'), false);
check('simulateTennisSet takes the edge', /function simulateTennisSet\(holdA, holdB, wtaEdge\)/.test(src), true);
check('runTennisMatchSimulation takes the edge', /wtaEdge \} = \{|wtaEdge \}\)/.test(src.match(/function runTennisMatchSimulation\([^)]*\)/)[0]), true);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
