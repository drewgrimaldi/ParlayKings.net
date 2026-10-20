// Market-as-information tests (rewritten 2026-10-19; was market-anchor).
//
// Drew's order, 2026-10-19: the market anchor is REMOVED. The market
// price (Polymarket where a liquid market exists) is information shown
// to the model BEFORE it decides, weighed like every other input; the
// model makes its own pick; nothing at logging may override the pick.
// The 2026-10-13 anchor (favorite by default, dissent only inside
// 45% implied / 10-point bars, logging-layer flip to the favorite) is
// gone from the prompt, the logger, and the bundle.
//
// Layers pinned here:
//  - marketAnchorDecision no longer exists and the logger never calls
//    it, never stamps an anchor note/flip, and never rewrites the
//    winner or confidence to the favorite's implied number.
//  - The Polymarket snapshot stash at logging time stays (measurement).
//  - Prompt: MARKET INFORMATION replaces the MARKET ANCHOR rule; no
//    default side, no dissent bars.
//  - Private diagnostics still parse HISTORICAL anchor-era notes
//    (records logged 2026-10-13..19 carry them; the TRACK RECORD block
//    must keep reading them correctly).

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

eval(extractFn('anchorPrefix'));
eval(extractFn('normalizeConfPct'));
eval(extractFn('extractFinalScoreFromNotes'));
eval(extractFn('parseScoreMargin'));
eval(extractFn('extractOddsSnapshotFromNotes'));
eval(extractFn('privateDiagForRecord'));

// --- the gate is gone ---
check('marketAnchorDecision no longer exists', !src.includes('function marketAnchorDecision'));
check('logger never calls the gate', !src.includes('marketAnchorDecision(pick, _snap)'));
check('logger never stamps an anchor flip', !src.includes('pick._anchorFlip = {'));
check('logger never stamps an anchor note', !src.includes('pick._anchorNote = _polySnap'));

// --- wiring in the logging layer ---
const innerStart = src.indexOf('async function _logBetToAirtableInner');
const innerEnd = src.indexOf('async function fetchGradedHistoryRecords', innerStart);
const inner = src.slice(innerStart, innerEnd);
check('Polymarket snapshot still stashed at logging (measurement)', inner.includes('await fetchPolymarketSnap(env, pick)'));
check('no favorite-confidence rewrite in the logger', !inner.includes('Math.max(51, Math.round(_dec.favImplied))'));
check('all three Notes call sites carry the anchor prefix', (src.match(/notesWithReplyAndOdds\(anchorPrefix\(/g) || []).length === 3);

// --- prefix helper (kept: renders historical notes on refresh paths) ---
check('anchorPrefix passes through without a note', anchorPrefix('pre', {}) === 'pre');
check('anchorPrefix appends the note', anchorPrefix('pre', { _anchorNote: 'NOTE' }).includes('NOTE'));

// --- prompt rule ---
check('prompt carries the MARKET INFORMATION rule', src.includes('MARKET INFORMATION: some questions will be preceded by a hidden block labeled "MARKET"'));
check('prompt states the price is information, never an instruction', src.includes('one more piece of information to weigh, never an instruction'));
check('prompt states there is no default side', src.includes('There is no default side and no zone you have to stay inside'));
check('prompt no longer carries the MARKET ANCHOR rule', !src.includes('MARKET ANCHOR: when a market line is available for the matchup in front of you'));
check('prompt no longer states the dissent bars', !src.includes('Take the other side only when BOTH of these hold'));

// --- private diagnostics: historical anchor-era records still parse ---
const flipNotes = 'Auto-logged from ai.grimaldi.tv (SAM 1.6) \u00B7 Market anchor: pick follows the market favorite Favorite Team (59% implied); the sim had Dog Team at 62% (market 41% implied), outside the dissent zone. \u00B7 Q: test\n---FULL-REPLY---\nx\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":140,"winnerImplied":41,"otherName":"Favorite Team","otherPrice":-160,"otherImplied":59}';
const flipDiag = privateDiagForRecord({ fields: { Notes: flipNotes, Result: 'Loss', 'Confidence %': 0.59 } });
check('priv flags a historical anchor flip with the sim numbers', flipDiag.includes('market_anchor_flip(sim_conf=62 dog_impl=41)'));
check('a flipped pick is NOT also labeled a dissent', !flipDiag.includes('market: dissent'));

const sidedNotes = 'notes\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":-170,"winnerImplied":63,"otherName":"Other Team","otherPrice":150,"otherImplied":40}';
const sidedDiag = privateDiagForRecord({ fields: { Notes: sidedNotes, Result: 'Win', 'Confidence %': 0.6 } });
check('priv labels a sided pick', sidedDiag.includes('market: sided(impl=63)'));

const dissentNotes = 'notes\n---ODDSLINE---{"bookmakerTitle":"DK","winnerPrice":110,"winnerImplied":47,"otherName":"Favorite Team","otherPrice":-130,"otherImplied":53}';
const dissentDiag = privateDiagForRecord({ fields: { Notes: dissentNotes, Result: 'Win', 'Confidence %': 0.55 } });
check('priv labels a kept dissent with its gap', dissentDiag.includes('market: dissent(impl=47 gap=8)'));

console.log(`market-anchor: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
