// FOOTBALL KV STAT TABLES (Drew's call 2026-10-06):
// The NFL/CFB advanced-stat tables live in KV (nfl_epa_v1 / cfb_adv_v1) and
// the worker pulls them fresh on every prediction. Stats live in the data
// store, never baked into the code. The embedded tables are fallback only.
// Tests the REAL bundle code by extracting from ../src/index.js (never a copy).
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

for (const n of ['__name','__name2','__name22','__name222','__name2222']) {
  globalThis[n] = (f) => f;
}

const bundle = [
  extractConst('NFL_NAME_TO_ABBR').replace(/^const /, 'var '),
  extractConst('NFL_TEAM_EPA').replace(/^const /, 'var '),
  extractConst('CFB_TEAM_ADV').replace(/^const /, 'var '),
  extractConst('FOOTBALL_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  extractConst('CFB_IMPORTANCE_WEIGHTS').replace(/^const /, 'var '),
  'var _nflEpaCache = { at: 0, table: null };',
  'var _cfbAdvCache = { at: 0, table: null };',
  'var KV_STAT_TTL_MS = 3600e3;',
  extractFn('kvStatTable'),
  extractFn('getNflEpaTable'),
  extractFn('getCfbAdvTable'),
  extractFn('nflEpaForTeamName'),
  extractFn('cfbAdvForTeamName'),
  extractFn('footballClampEdge'),
  extractFn('cfbWeightedCompositeEdge'),
  extractFn('footballWeightedCompositeEdge'),
];
eval(bundle.join('\n'));

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' => ' + JSON.stringify(got) +
    (ok ? '' : ' (expected ' + JSON.stringify(want) + ')'));
}
function checkTrue(name, cond) {
  if (!cond) failed++;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name);
}

(async () => {
  // 1. Lookup honors the passed table (KV-fresh data wins over embedded).
  const kvTable = { KC: { gp: 4, offEpa: 0.99, defEpa: -0.99, qbComposite: 9.9 } };
  const hit = nflEpaForTeamName('Kansas City Chiefs', kvTable);
  check('nflEpaForTeamName uses passed table', hit && hit.offEpa, 0.99);

  // 2. Lookup falls back to embedded when no table passed.
  const fb = nflEpaForTeamName('Kansas City Chiefs', null);
  checkTrue('nflEpaForTeamName falls back to embedded', fb && typeof fb.offEpa === 'number' && fb.offEpa !== 0.99);

  // 3. CFB lookup honors the passed table.
  const kvCfb = { teams: { GEO: { gp: 4, offRushSr: 0.77 } }, lookup: { georgia: 'GEO' } };
  const cHit = cfbAdvForTeamName('Georgia', kvCfb);
  check('cfbAdvForTeamName uses passed table', cHit && cHit.offRushSr, 0.77);

  // 4. CFB lookup falls back to embedded.
  const cFb = cfbAdvForTeamName('Georgia', null);
  checkTrue('cfbAdvForTeamName falls back to embedded', !!cFb);

  // 5. Composite uses the passed EPA table: a lopsided KV table must move E.
  const tableA = { KC: { gp: 8, offEpa: 0.5, defEpa: -0.5, offSr: 0.5, defSr: 0.5, passEpaDb: 0.5, defPassEpaDb: -0.5, rushEpaPc: 0.3, defRushEpaPc: -0.3, offEarlySr: 0.5, defEarlySr: 0.5, defRzTd: 0.5, qbComposite: 2.0, expRate: 0.1, defExpRate: 0.1, rzTd: 0.6, stEpa: 0, penNet: 0, pressGen: 0.1, pressAllowed: 0.1 } };
  const tableB = { LV: { gp: 8, offEpa: -0.5, defEpa: 0.5, offSr: 0.5, defSr: 0.5, passEpaDb: -0.5, defPassEpaDb: 0.5, rushEpaPc: -0.3, defRushEpaPc: 0.3, offEarlySr: 0.5, defEarlySr: 0.5, defRzTd: 0.5, qbComposite: -2.0, expRate: 0.1, defExpRate: 0.1, rzTd: 0.6, stEpa: 0, penNet: 0, pressGen: 0.1, pressAllowed: 0.1 } };
  const kvBoth = Object.assign({}, tableA, tableB);
  const comp = footballWeightedCompositeEdge({
    teamA: 'Kansas City Chiefs', teamB: 'Las Vegas Raiders',
    league: 'NFL', epaTable: kvBoth, cfbTable: null,
  });
  checkTrue('composite with KV table favors the better EPA team (E>0)', comp.edge > 0);

  // 6. getNflEpaTable falls back to embedded when KV is absent.
  const t1 = await getNflEpaTable({});
  checkTrue('getNflEpaTable falls back to embedded without KV', t1 && Object.keys(t1).length === 32);

  // 7. getNflEpaTable reads live KV data when present.
  // Build a full 32-team KV payload (the validator rejects partial tables).
  const fullKvNfl = {};
  const abbrs = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
  for (const a of abbrs) fullKvNfl[a] = Object.assign({}, tableB.LV);
  fullKvNfl.KC = { gp: 8, offEpa: 0.99, defEpa: -0.99, qbComposite: 9.9 };
  const fakeKv = { get: async (k) => k === 'nfl_epa_v1' ? JSON.stringify(fullKvNfl) : null };
  _nflEpaCache.at = 0; _nflEpaCache.table = null;
  const t2 = await getNflEpaTable({ SAM_BETS: fakeKv });
  check('getNflEpaTable returns live KV table', t2 && t2.KC && t2.KC.offEpa, 0.99);

  // 8. getCfbAdvTable falls back to embedded without KV.
  const c1 = await getCfbAdvTable({});
  checkTrue('getCfbAdvTable falls back to embedded without KV', c1 && c1.teams && Object.keys(c1.teams).length === 138);

  // 9. getCfbAdvTable reads live KV data when present (full 138-team payload).
  const fullKvCfb = { teams: {}, lookup: { georgia: 'GEO' } };
  for (let i = 0; i < 137; i++) fullKvCfb.teams['T' + i] = { gp: 4, offRushSr: 0.5 };
  fullKvCfb.teams.GEO = { gp: 4, offRushSr: 0.77 };
  const fakeCfbKv = { get: async (k) => k === 'cfb_adv_v1' ? JSON.stringify(fullKvCfb) : null };
  _cfbAdvCache.at = 0; _cfbAdvCache.table = null;
  const c2 = await getCfbAdvTable({ SAM_BETS: fakeCfbKv });
  check('getCfbAdvTable returns live KV table', c2 && c2.teams && c2.teams.GEO && c2.teams.GEO.offRushSr, 0.77);

  // 10. Invalid KV payload is rejected (falls back to embedded, never corrupt).
  const badKv = { get: async () => JSON.stringify({ nope: true }) };
  _nflEpaCache.at = 0; _nflEpaCache.table = null;
  const t3 = await getNflEpaTable({ SAM_BETS: badKv });
  checkTrue('invalid KV payload rejected, embedded fallback used', t3 && Object.keys(t3).length === 32);

  if (failed) { console.log(failed + ' CHECK(S) FAILED'); process.exit(1); }
  console.log('all football kv tables tests passed');
})();
