// Edge gate is REMOVED from published output (Drew, 2026-09-21: "get edge
// gate out of there"). No prediction reply may contain an edge verdict
// (BET/HOLD/PASS by edge), an edge-points number, a "fair price", stake
// sizing, or the old demotion line. The raw market line stays as plain data.
// Tests the REAL formatCurrentMarketLine() from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let p = src.indexOf('(', start), pd = 0, qi = p;
  for (; qi < src.length; qi++) {
    if (src[qi] === '(') pd++;
    if (src[qi] === ')') { pd--; if (!pd) break; }
  }
  let i = src.indexOf('{', qi), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

eval(extract('isFiftyFiftyWinner'));
eval(extract('formatOddsLine'));
eval(extract('matchupSideNames'));
eval(extract('oddsLookupWinner'));
eval(extract('formatCurrentMarketLine'));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

const BANNED = [
  'Edge gate', 'pts vs market', 'fair ', 'fair(', 'stake',
  'no stake recommended', 'or better', 'Kelly', 'BET', 'HOLD', 'PASS'
];

const pick = { winner: 'Yankees', confidence: 70, matchup: 'Yankees vs Red Sox', league: 'MLB' };
const current = {
  bookmakerTitle: 'DraftKings', winnerPrice: -150, winnerImplied: 60,
  otherName: 'Red Sox', otherPrice: 130, otherImplied: 43.5
};
const out = formatCurrentMarketLine(current, pick);

check('market block still renders', typeof out === 'string' && out.includes('**Market Line (DraftKings):**'));
check('market line keeps the raw price', out.includes('-150') && out.includes('60% implied'));
check('market line keeps both sides', out.includes('Red Sox') && out.includes('+130'));
for (const b of BANNED) {
  check('no edge-gate residue: ' + JSON.stringify(b), !out.includes(b));
}

// Market comparison restored (Drew's call 2026-09-22): model-vs-market numbers
// are back, but no verdicts and no staking.
check('market comparison present', out.includes('over the market'));
check('no bet verdict', !out.includes('**BET**') && !out.includes('**HOLD**') && !out.includes('**PASS**'));

// 50/50 picks keep their honest note, still with no edge text.
const ff = formatCurrentMarketLine(current, { winner: '50/50', confidence: 50, matchup: 'A vs B', league: 'UFC' });
check('50/50 note survives', ff.includes('50/50, not a side'));
for (const b of BANNED) {
  check('50/50 output has no edge-gate residue: ' + JSON.stringify(b), !ff.includes(b));
}

// The gate machinery itself is gone from live code (historical changelog
// notes may still mention it — those are immutable history).
for (const sig of ['function edgeGateVerdict(', 'function edgeGate(', 'function kellyStakePct(', 'var EDGE_BET_THRESHOLD']) {
  check('removed from bundle: ' + sig, !src.includes(sig));
}

console.log(`edge-gate-removed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
