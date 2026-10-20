// Tennis Polymarket matching tests (2026-10-20).
//
// The game-sport matcher requires the event's endDate ET date to
// equal the pick's date and fetches only a +/-16h window around it.
// Tournament tennis breaks both assumptions: a match market is
// created when the tournament is listed and its endDate sits at the
// tournament's scheduled end, so a mid-tournament match was never
// fetched and never stored (2026-10-20: 17 of 20 picks carried a
// Polymarket line; the 3 misses were all WTA, at Ningbo, where the
// markets existed the whole time). The tennis path therefore:
// fetches a tournament window, matches by date-span containment,
// allows player names in either order, and resolves a Qualification
// vs main-draw double listing instead of taking the first match.
// Game sports keep the strict same-day gate untouched.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + label); }
}

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  let quote = null, lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function ' + name);
}

eval(extractFn('polymarketTeamKey'));
eval(extractFn('polymarketTitleSideKey'));
eval(extractFn('polymarketEventDateET'));
eval(extractFn('polymarketEventSpanContainsET'));
eval(extractFn('polymarketPlayerKeysMatch'));
eval(extractFn('evaluatePolymarketLiquidityGate'));
eval(extractFn('polymarketTeamKeysMatch'));
eval(src.match(/const POLYMARKET_NAME_DISTINGUISHERS[^;]+;/)[0].replace('const POLYMARKET_NAME_DISTINGUISHERS', 'globalThis.POLYMARKET_NAME_DISTINGUISHERS'));
eval(extractFn('polymarketSnapFromEvent'));
eval(extractFn('polymarketTournamentWindow'));
eval(extractFn('pickPolymarketCandidate'));

// The live Ningbo listings for the 2026-10-20 picks (Gamma series
// 10366): tournament-prefixed title, endDate days after match day.
const NINGBO_MAIN = {
  title: 'Ningbo Open: Hanyu Guo vs Ekaterina Alexandrova',
  slug: 'wta-guo-alexandrova-2026-10-20',
  startDate: '2026-10-17T22:14:18Z',
  endDate: '2026-10-26T02:00:00Z',
  markets: [
    { sportsMarketType: 'moneyline', outcomes: '["Hanyu Guo","Ekaterina Alexandrova"]', outcomePrices: '["0.41","0.59"]', volumeNum: 21000, liquidityNum: 4300, spread: 0.02 }
  ]
};
const NINGBO_SNIGUR_MAIN = {
  title: 'Ningbo Open: Katarzyna Kawa vs Daria Snigur',
  slug: 'wta-kawa-snigur-2026-10-20',
  startDate: '2026-10-19T10:14:16Z',
  endDate: '2026-10-27T09:30:00Z',
  markets: [
    { sportsMarketType: 'moneyline', outcomes: '["Katarzyna Kawa","Daria Snigur"]', outcomePrices: '["0.47","0.53"]', volumeNum: 9000, liquidityNum: 2100, spread: 0.03 }
  ]
};
const NINGBO_SNIGUR_QUAL = {
  title: 'Ningbo Open, Qualification: Daria Snigur vs Katarzyna Kawa',
  slug: 'wta-snigur-kawa-qual-2026-10-18',
  startDate: '2026-10-17T10:14:14Z',
  endDate: '2026-10-25T03:00:00Z',
  markets: [
    { sportsMarketType: 'moneyline', outcomes: '["Daria Snigur","Katarzyna Kawa"]', outcomePrices: '["0.55","0.45"]', volumeNum: 6000, liquidityNum: 1600, spread: 0.04 }
  ]
};

// --- the miss, reproduced and fixed ---
const t1 = polymarketSnapFromEvent(NINGBO_MAIN, 'Ekaterina Alexandrova', 'Guo Hanyu', 'Ekaterina Alexandrova', '2026-10-20', { tennis: true });
check('Ningbo main-draw matches on the tennis path', !!t1 && t1.winnerImplied === 59 && t1.otherImplied === 41 && t1.otherName === 'Hanyu Guo');
check('same event rejected on the default (game-sport) path', polymarketSnapFromEvent(NINGBO_MAIN, 'Ekaterina Alexandrova', 'Guo Hanyu', 'Ekaterina Alexandrova', '2026-10-20') === null);
check('player-name order: the pick winner in family-first order resolves', (() => { const s = polymarketSnapFromEvent(NINGBO_MAIN, 'Ekaterina Alexandrova', 'Guo Hanyu', 'Guo Hanyu', '2026-10-20', { tennis: true }); return !!s && s.winnerImplied === 41 && s.otherImplied === 59; })());

// --- span edges ---
check('pick date before the event span rejected', polymarketSnapFromEvent(NINGBO_MAIN, 'Ekaterina Alexandrova', 'Guo Hanyu', 'Ekaterina Alexandrova', '2026-10-15', { tennis: true }) === null);
check('pick date after the event span rejected', polymarketSnapFromEvent(NINGBO_MAIN, 'Ekaterina Alexandrova', 'Guo Hanyu', 'Ekaterina Alexandrova', '2026-10-30', { tennis: true }) === null);
check('different pair rejected on the tennis path', polymarketSnapFromEvent(NINGBO_MAIN, 'Belinda Bencic', 'Jelena Ostapenko', 'Belinda Bencic', '2026-10-20', { tennis: true }) === null);
check('span helper: endpoints inclusive', polymarketEventSpanContainsET(NINGBO_MAIN, '2026-10-17') === true && polymarketEventSpanContainsET(NINGBO_MAIN, '2026-10-25') === true);

// --- player key matching is token-exact, not fuzzy ---
check('player keys: same tokens any order', polymarketPlayerKeysMatch('guo hanyu', 'hanyu guo') === true);
check('player keys: different players never match', polymarketPlayerKeysMatch('guo hanyu', 'guo xinyu') === false);
check('player keys: single-token names never match by shuffle', polymarketPlayerKeysMatch('guo', 'guo') === false);

// --- tournament window covers the tournament span ---
const win = polymarketTournamentWindow('2026-10-20');
check('tournament window fetches the Ningbo endDate', !!win && win.min <= '2026-10-26T02:00:00Z' && win.max >= '2026-10-26T02:00:00Z');
check('tournament window starts before match day', !!win && win.min < '2026-10-20T00:00:00Z');

// --- Qualification vs main-draw disambiguation ---
const qualSnap = polymarketSnapFromEvent(NINGBO_SNIGUR_QUAL, 'Daria Snigur', 'Katarzyna Kawa', 'Daria Snigur', '2026-10-20', { tennis: true });
const mainSnap = polymarketSnapFromEvent(NINGBO_SNIGUR_MAIN, 'Daria Snigur', 'Katarzyna Kawa', 'Daria Snigur', '2026-10-20', { tennis: true });
check('both Snigur listings individually match the span', !!qualSnap && !!mainSnap && mainSnap.winnerImplied === 53);
check('candidate pick prefers the main draw over Qualification', pickPolymarketCandidate([{ snap: qualSnap, event: NINGBO_SNIGUR_QUAL }, { snap: mainSnap, event: NINGBO_SNIGUR_MAIN }]) === mainSnap);
check('candidate pick: single candidate passes through', pickPolymarketCandidate([{ snap: mainSnap, event: NINGBO_SNIGUR_MAIN }]) === mainSnap);
check('candidate pick: empty stores nothing', pickPolymarketCandidate([]) === null);
check('candidate pick: two main-draw listings, latest start wins', (() => {
  const later = { ...NINGBO_SNIGUR_MAIN, startDate: '2026-10-20T08:00:00Z' };
  const laterSnap = { ...mainSnap, winnerImplied: 61 };
  return pickPolymarketCandidate([{ snap: mainSnap, event: NINGBO_SNIGUR_MAIN }, { snap: laterSnap, event: later }]) === laterSnap;
})());
check('candidate pick: indistinguishable tie stores nothing', (() => {
  const twin = { ...mainSnap, winnerImplied: 61 };
  return pickPolymarketCandidate([{ snap: mainSnap, event: NINGBO_SNIGUR_MAIN }, { snap: twin, event: NINGBO_SNIGUR_MAIN }]) === null;
})());

console.log(`polymarket-tennis: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
