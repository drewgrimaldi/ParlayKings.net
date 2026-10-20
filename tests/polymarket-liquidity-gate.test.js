// Polymarket liquidity gate + flip-receipt tests (2026-10-16).
//
// SAM 1.7.2 made Polymarket the market anchor's market of record.
// This gate decides which Polymarket prices are REAL enough to hold
// that job: actively accepting orders, >= $5,000 traded volume,
// >= $1,500 standing book depth, spread <= 5c. A failing price is
// still stored on the record for measurement (with its metrics);
// the anchor falls back to the sportsbook text parse. Also pinned:
// anchor flips keep their receipts — snapshots stored re-based to
// the logged side and marked anchorFlipped — and BOTH segment
// classifiers (worker priv diagnostics + daily_record.py) recognize
// the Polymarket anchor sentence, not just the sportsbook one.

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
  throw new Error('unterminated ' + name);
}

eval(extractFn('evaluatePolymarketLiquidityGate'));
eval(extractFn('polymarketTeamKey'));
eval(extractFn('polymarketEventDateET'));
eval(extractFn('polymarketSnapFromEvent'));
eval(extractFn('polymarketTeamKeysMatch'));
eval(src.match(/const POLYMARKET_NAME_DISTINGUISHERS[^;]+;/)[0].replace('const POLYMARKET_NAME_DISTINGUISHERS', 'globalThis.POLYMARKET_NAME_DISTINGUISHERS'));
eval(extractFn('reorientSnapshotForFlip'));
eval(extractFn('appendPolymarketSnapshotToNotes'));

// --- Gate: unit behavior against live-shaped Gamma payloads
const deep = { volumeNum: 58428, liquidityNum: 515171, spread: 0.01, bestBid: 0.43, bestAsk: 0.44, acceptingOrders: true, active: true, closed: false };
check('deep NFL-shaped market qualifies', evaluatePolymarketLiquidityGate(deep).qualified === true);
check('thin market fails on volume', evaluatePolymarketLiquidityGate({ ...deep, volumeNum: 212 }).reason === 'INSUFFICIENT_VOLUME');
check('low book depth fails on liquidity', evaluatePolymarketLiquidityGate({ ...deep, liquidityNum: 900 }).reason === 'INSUFFICIENT_LIQUIDITY');
check('wide spread fails', evaluatePolymarketLiquidityGate({ ...deep, spread: 0.36 }).reason === 'WIDE_SPREAD');
check('spread derived from bid/ask when absent', evaluatePolymarketLiquidityGate({ volumeNum: 9000, liquidityNum: 20000, bestBid: 0.40, bestAsk: 0.76, acceptingOrders: true, active: true }).reason === 'WIDE_SPREAD');
check('closed market fails', evaluatePolymarketLiquidityGate({ ...deep, closed: true }).reason === 'MARKET_INACTIVE');
check('not-accepting market fails', evaluatePolymarketLiquidityGate({ ...deep, acceptingOrders: false }).reason === 'MARKET_INACTIVE');
check('empty object fails closed for anchor use', evaluatePolymarketLiquidityGate({}).qualified === false);
check('string volume/liquidity fields are read', evaluatePolymarketLiquidityGate({ volume: '9000', liquidity: '20000', spread: '0.01', acceptingOrders: true, active: true }).qualified === true);

// --- Snap builder: gate fields ride along either way
const dateET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function evt(mkt) {
  return { title: 'Alpha vs Beta', slug: 'alpha-vs-beta', startDate: new Date().toISOString(),
    markets: [{ sportsMarketType: 'moneyline', outcomes: '["Alpha","Beta"]', outcomePrices: '["0.58","0.42"]', ...mkt }] };
}
const thinSnap = polymarketSnapFromEvent(evt({ volumeNum: 100, liquidityNum: 20000, spread: 0.01, acceptingOrders: true, active: true }), 'Alpha', 'Beta', 'Alpha', dateET);
check('thin snap still builds (storage continues)', !!thinSnap);
check('thin snap is marked unqualified', thinSnap && thinSnap.anchorQualified === false && thinSnap.gateReason === 'INSUFFICIENT_VOLUME');
check('thin snap carries its metrics', thinSnap && thinSnap.volume === 100 && thinSnap.liquidity === 20000);
const deepSnap = polymarketSnapFromEvent(evt(deep), 'Alpha', 'Beta', 'Alpha', dateET);
check('deep snap is qualified', !!deepSnap && deepSnap.anchorQualified === true);

// --- Re-orientation on flips
const ro = reorientSnapshotForFlip(
  { bookmakerTitle: 'Book', winnerPrice: 150, winnerImplied: 40, otherName: 'Fav', otherPrice: -170, otherImplied: 63 },
  { dogName: 'Dog' });
check('re-oriented winner takes the favorite price', ro.winnerPrice === -170 && ro.winnerImplied === 63);
check('re-oriented other is the faded dog', ro.otherName === 'Dog' && ro.otherPrice === 150 && ro.otherImplied === 40);
check('re-oriented snapshot is marked', ro.anchorFlipped === true);

// --- POLYLINE serialization carries gate + flip fields
const stored = appendPolymarketSnapshotToNotes('N', { winnerImplied: 63, otherName: 'Dog', otherImplied: 40, eventSlug: 'x', anchorQualified: false, volume: 100, liquidity: 20000, spread: 0.01, anchorFlipped: true });
check('polyline stores qualification + metrics', stored.includes('---POLYLINE---') && stored.includes('"anchorQualified":false') && stored.includes('"volume":100'));
check('polyline stores the flip mark', stored.includes('"anchorFlipped":true'));

// --- Classifier parity: the priv-diag regex matches BOTH anchor sentences
const mStart = src.indexOf('const anchorM = notes.match(');
const mLine = src.slice(mStart, src.indexOf('\n', mStart));
const anchorRe = eval(mLine.slice(mLine.indexOf('(') + 1, mLine.lastIndexOf(')') ));
const marketNote = 'x · Market anchor: pick follows the market favorite Fav (63% implied); the sim had Dog at 53% (market 40% implied), outside the dissent zone.';
const polyNote = 'x · Polymarket anchor: pick follows the Polymarket favorite Fav (63% implied); the sim had Dog at 53% (Polymarket 40% implied), outside the dissent zone.';
check('priv regex matches the sportsbook flip note', !!marketNote.match(anchorRe));
check('priv regex matches the Polymarket flip note', !!polyNote.match(anchorRe));
const pm = polyNote.match(anchorRe);
check('priv regex extracts sim conf + dog implied from a Polymarket note', !!pm && pm[1] === '53' && pm[2] === '40');

// --- Wiring: only qualified prices reach the model as information; the report port matches
check('the pre-decision info block is qualification-gated', src.includes('snap && snap.anchorQualified'));
check('no flip context is stashed anymore (anchor removed 2026-10-19)', !src.includes('pick._anchorFlip = {'));
const py = fs.readFileSync(__dirname + '/../../daily_record.py', 'utf8');
check('daily_record.py ANCHOR_RE covers Polymarket flips', py.includes('Polymarket anchor: pick follows the Polymarket favorite'));

console.log(`polymarket-liquidity-gate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
