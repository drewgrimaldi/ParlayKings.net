// Market anchor tests (2026-10-13).
//
// Drew's rule: the logged pick stays tied to reality. When a market line
// exists, the market favorite is the pick by default. The model may take
// the other side only inside a narrow dissent zone — the dog priced at
// 45% implied or better (a near-even game) with the sim's claimed edge
// over the market at 10 points or less. Outside the zone, the logging
// layer flips the pick to the favorite and states the favorite's implied
// number. The bars come from the model's own graded record: sided picks
// hit 62% in the current era vs 43% for fades; fades priced under 40%
// implied hit 27%; fades claiming a 15+ point edge hit 32%.
//
// Layers pinned here:
//  - marketAnchorDecision: the pure gate.
//  - Wiring: the gate runs inside _logBetToAirtableInner next to the
//    force-side rule, and the flip note rides into the Notes prefix at
//    all three notesWithReplyAndOdds call sites.
//  - Prompt: the MARKET ANCHOR instruction tells the model the same rule
//    upstream so flips at logging stay rare.
//  - Private diagnostics: flips / sided / dissent tokens for the hidden
//    TRACK RECORD context.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + label); }
}

function extractFn(name) {
  // Brace counting that ignores braces inside strings, template
  // literals, and comments — a naive counter breaks on any function
  // whose body contains a "{" or "}" literal (bit the suite 2026-10-15).
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
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

eval(extractFn('marketAnchorDecision'));
eval(extractFn('anchorPrefix'));
eval(extractFn('normalizeConfPct'));
eval(extractFn('extractFinalScoreFromNotes'));
eval(extractFn('parseScoreMargin'));
eval(extractFn('extractOddsSnapshotFromNotes'));
eval(extractFn('privateDiagForRecord'));

const pick = (confidence, winner) => ({ confidence, winner: winner || 'Dog Team' });
const snap = (winnerImplied, otherImplied, otherName) => ({
  winnerImplied, otherImplied, otherName: otherName == null ? 'Favorite Team' : otherName
});

// --- the pure gate ---
check('no snapshot -> keep', marketAnchorDecision(pick(58), null).action === 'keep');
check('missing other implied -> keep', marketAnchorDecision(pick(58), { winnerImplied: 41, otherImplied: null, otherName: 'Fav' }).action === 'keep');
check('sided with the favorite -> keep', (() => { const d = marketAnchorDecision(pick(61), snap(63, 37)); return d.action === 'keep' && d.sided === true; })());
check('exactly 50 implied -> keep (sided)', marketAnchorDecision(pick(55), snap(50, 50)).action === 'keep');
check('dissent zone: 47 implied, gap 8 -> keep', (() => { const d = marketAnchorDecision(pick(55), snap(47, 53)); return d.action === 'keep' && d.dissent === true && d.gap === 8; })());
check('dissent zone edge: 46 implied, gap 10 -> keep', marketAnchorDecision(pick(56), snap(46, 54)).action === 'keep');
check('dissent floor: exactly 45 implied, gap 9 -> keep', marketAnchorDecision(pick(54), snap(45, 55)).action === 'keep');
check('gap 13 on a 47 dog -> flip', (() => { const d = marketAnchorDecision(pick(60), snap(47, 53)); return d.action === 'flip' && d.favName === 'Favorite Team' && d.favImplied === 53; })());
check('44 implied dog -> flip even with a modest gap', marketAnchorDecision(pick(52), snap(44, 56)).action === 'flip');
check('long shot: 58 claimed on a 34 dog -> flip', marketAnchorDecision(pick(58), snap(34, 66)).action === 'flip');
check('flip needs a named favorite', marketAnchorDecision(pick(58), snap(34, 66, '')).action === 'keep');
check('fraction confidence is normalized (0.57 vs 47 -> gap 10, keep)', marketAnchorDecision(pick(0.57), snap(47, 53)).action === 'keep');
check('fraction confidence flip case (0.62 vs 41 -> flip)', marketAnchorDecision(pick(0.62), snap(41, 59)).action === 'flip');

// --- prefix helper ---
check('anchorPrefix passes through without a note', anchorPrefix('pre', {}) === 'pre');
check('anchorPrefix appends the note', anchorPrefix('pre', { _anchorNote: 'NOTE' }).includes('NOTE'));

// --- wiring in the logging layer ---
const innerStart = src.indexOf('async function _logBetToAirtableInner');
const innerEnd = src.indexOf('async function fetchGradedHistoryRecords', innerStart);
const inner = src.slice(innerStart, innerEnd);
check('gate runs inside _logBetToAirtableInner', inner.includes('marketAnchorDecision(pick, _snap)'));
check('gate skips declared 50/50 picks', inner.includes('!isFiftyFiftyWinner(pick.winner)'));
check('flip rewrites winner + confidence and stamps the note', inner.includes('`Market anchor: pick follows the market favorite') && inner.includes('`Polymarket anchor: pick follows the Polymarket favorite'));
check('flip confidence floors at 51', inner.includes('Math.max(51, Math.round(_dec.favImplied))'));
check('all three Notes call sites carry the anchor prefix', (src.match(/notesWithReplyAndOdds\(anchorPrefix\(/g) || []).length === 3);

// --- prompt rule ---
check('prompt carries the MARKET ANCHOR rule', src.includes('MARKET ANCHOR: when a market line is available for the matchup in front of you'));
check('prompt states the 45% / 10-point dissent bars', src.includes('at least a 45% implied chance') && src.includes('no more than 10 points'));
check('prompt states the flip-side presentation', src.includes('present the market\'s implied price as the pick\'s basis'));

// --- private diagnostics ---
const flipNotes = 'Auto-logged from ai.grimaldi.tv (SAM 1.6) \u00B7 Market anchor: pick follows the market favorite Favorite Team (59% implied); the sim had Dog Team at 62% (market 41% implied), outside the dissent zone. \u00B7 Q: test\n---FULL-REPLY---\nx\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":140,"winnerImplied":41,"otherName":"Favorite Team","otherPrice":-160,"otherImplied":59}';
const flipDiag = privateDiagForRecord({ fields: { Notes: flipNotes, Result: 'Loss', 'Confidence %': 0.59 } });
check('priv flags an anchor flip with the sim numbers', flipDiag.includes('market_anchor_flip(sim_conf=62 dog_impl=41)'));
check('a flipped pick is NOT also labeled a dissent', !flipDiag.includes('market: dissent'));

const sidedNotes = 'notes\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":-170,"winnerImplied":63,"otherName":"Other Team","otherPrice":150,"otherImplied":40}';
const sidedDiag = privateDiagForRecord({ fields: { Notes: sidedNotes, Result: 'Win', 'Confidence %': 0.6 } });
check('priv labels a sided pick', sidedDiag.includes('market: sided(impl=63)'));

const dissentNotes = 'notes\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":110,"winnerImplied":47,"otherName":"Favorite Team","otherPrice":-130,"otherImplied":53}';
const dissentDiag = privateDiagForRecord({ fields: { Notes: dissentNotes, Result: 'Win', 'Confidence %': 0.55 } });
check('priv labels a kept dissent with its gap', dissentDiag.includes('market: dissent(impl=47 gap=8)'));

console.log(`market-anchor: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
