// Shadow guard tests (2026-11-04).
//
// Drew's order, from the post-anchor audit (Oct 20 - Nov 4: SAM 66.0%
// vs the same-game market-favorite baseline 67.1%; the anchor beat the
// original model paired +8 net on 32 moved games but adds no measured
// value over the market itself): instrument a two-source market
// coverage guard in SHADOW mode. It judges the model's original pick at
// logging against qualified Polymarket first, a price-quality-checked
// sportsbook line second, flags material source disagreement, and
// would-abstain when neither reference is reliable. The verdict is
// written to the record as a SHADOWGUARD block and changes NOTHING live:
// no pick, no confidence, no gate. SAM 1.7.3 stays conditional on the
// shadow record; the model stays 1.7.2.
//
// The historical seam this targets: the live gate falls back to the
// reply text's market line only, so when a Polymarket snapshot exists
// but is unqualified and the reply line does not parse, a pick logs
// ungated even though a book price was fetched (pick._marketOdds).

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
    if (c === '/' && n === '/') { lineComment = true; continue; }
    if (c === '/' && n === '*') { blockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function ' + name);
}

eval(extractFn('marketAnchorDecision'));
eval(extractFn('shadowSnapUsable'));
eval(extractFn('shadowBookQualityOk'));
eval(extractFn('shadowGuardDecision'));
eval(extractFn('appendShadowGuardToNotes'));

const polyQ = (w, o, otherName) => ({ winnerImplied: w, otherImplied: o, otherName: otherName || 'Other Side', anchorQualified: true, source: 'Polymarket' });
const polyU = (w, o, otherName) => ({ winnerImplied: w, otherImplied: o, otherName: otherName || 'Other Side', anchorQualified: false, source: 'Polymarket' });
const book = (w, o, otherName) => ({ winnerImplied: w, otherImplied: o, otherName: otherName || 'Other Side', bookmakerTitle: 'DraftKings', winnerPrice: -110, otherPrice: -110 });

// 1. Qualified Polymarket, pick is the favorite -> pass on Polymarket.
let v = shadowGuardDecision({ winner: 'A', confidence: 62 }, polyQ(60, 40), null);
check('qualified poly sided -> pass', v.verdict === 'pass' && v.refSource === 'polymarket');

// 2. Qualified Polymarket, deep dog with a big claimed edge -> would-move.
v = shadowGuardDecision({ winner: 'A', confidence: 58 }, polyQ(40, 60, 'Fav Team'), null);
check('qualified poly deep dog -> would-move', v.verdict === 'would-move' && v.wouldMoveTo === 'Fav Team' && v.favImplied === 60 && v.refSource === 'polymarket');

// 3. Qualified Polymarket, near-even dissent inside the zone -> pass.
v = shadowGuardDecision({ winner: 'A', confidence: 55 }, polyQ(47, 53), null);
check('qualified poly in-zone dissent -> pass', v.verdict === 'pass' && v.gap === 8 && v.refSource === 'polymarket');

// 4. Unqualified Polymarket + reliable book that also fades the pick -> would-move on the book.
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, polyU(44, 56), book(42, 62, 'Book Fav'));
check('unqualified poly + book -> would-move on sportsbook', v.verdict === 'would-move' && v.refSource === 'sportsbook' && v.wouldMoveTo === 'Book Fav');

// 5. Unqualified Polymarket + reliable book, pick is the book favorite -> pass on the book.
v = shadowGuardDecision({ winner: 'A', confidence: 57 }, polyU(52, 48), book(55, 49));
check('unqualified poly + book sided -> pass on sportsbook', v.verdict === 'pass' && v.refSource === 'sportsbook');

// 6. Unqualified Polymarket, no book -> would-abstain, reason names the seam.
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, polyU(44, 56), null);
check('unqualified poly alone -> would-abstain', v.verdict === 'would-abstain' && /not liquidity-qualified/.test(v.reason));

// 7. Neither source -> would-abstain.
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, null, null);
check('no sources -> would-abstain', v.verdict === 'would-abstain' && v.refSource === 'none');

// 8. Qualified Polymarket vs book naming different favorites -> sources-disagree.
v = shadowGuardDecision({ winner: 'A', confidence: 55 }, polyQ(55, 45), book(45, 59));
check('different favorites (qualified poly) -> sources-disagree', v.verdict === 'sources-disagree' && v.refSource === 'both');

// 9. Unqualified Polymarket vs book naming different favorites -> sources-disagree.
v = shadowGuardDecision({ winner: 'A', confidence: 55 }, polyU(44, 56), book(54, 50));
check('different favorites (unqualified poly) -> sources-disagree', v.verdict === 'sources-disagree');

// 10. Same favorite, prices 10+ apart on the picked side -> sources-disagree.
v = shadowGuardDecision({ winner: 'A', confidence: 66 }, polyQ(72, 28), book(58, 46));
check('same favorite, 14 apart -> sources-disagree', v.verdict === 'sources-disagree' && /differ by 14 points/.test(v.reason));

// 11. Same favorite, prices close -> judged on qualified Polymarket.
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, polyQ(62, 38), book(58, 46));
check('sources close -> judged on polymarket', v.verdict === 'pass' && v.refSource === 'polymarket');

// 12. Book pair with an impossible margin (60+60) fails quality -> would-abstain behind unqualified poly.
check('book quality rejects 60/60 pair', shadowBookQualityOk(book(60, 60)) === false);
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, polyU(44, 56), book(60, 60));
check('bad book + unqualified poly -> would-abstain', v.verdict === 'would-abstain' && v.book && v.book.qualityOk === false);

// 13. Ordinary vig pair passes quality.
check('book quality accepts 55/49 pair', shadowBookQualityOk(book(55, 49)) === true);

// 14. Non-mutation: the judged pick and both snapshots are untouched.
const pickIn = { winner: 'A', confidence: 58 };
const polyIn = polyQ(40, 60, 'Fav Team');
const bookIn = book(42, 62, 'Book Fav');
const before = JSON.stringify([pickIn, polyIn, bookIn]);
shadowGuardDecision(pickIn, polyIn, bookIn);
check('shadow guard mutates nothing', JSON.stringify([pickIn, polyIn, bookIn]) === before);

// 15. Confidence normalization: fraction and percent both record as percent.
check('confidence 0.62 records 62', shadowGuardDecision({ winner: 'A', confidence: 0.62 }, polyQ(60, 40), null).originalConfidence === 62);
check('confidence 62 records 62', shadowGuardDecision({ winner: 'A', confidence: 62 }, polyQ(60, 40), null).originalConfidence === 62);

// 16. The verdict preserves both prices and the qualification flag.
v = shadowGuardDecision({ winner: 'A', confidence: 60 }, polyU(44, 56), book(42, 62));
check('verdict preserves poly prices + qualified=false', v.poly && v.poly.winnerImplied === 44 && v.poly.qualified === false);
check('verdict preserves book prices + title', v.book && v.book.winnerImplied === 42 && v.book.book === 'DraftKings');

// 17. Notes append: block carries the tag and JSON; missing verdict is a no-op.
const noted = appendShadowGuardToNotes('prefix', { verdict: 'pass', v: 1 });
check('notes append writes SHADOWGUARD block', noted.startsWith('prefix\n---SHADOWGUARD---') && JSON.parse(noted.split('---SHADOWGUARD---')[1]).verdict === 'pass');
check('notes append no-ops without a verdict', appendShadowGuardToNotes('prefix', null) === 'prefix' && appendShadowGuardToNotes('prefix', {}) === 'prefix');

// 18. Wiring: the verdict is computed in the logger BEFORE the live gate
// decision line, and the notes builder writes the block.
const sgAt = src.indexOf('pick._shadowGuard = _sg');
const gateAt = src.indexOf('const _dec = marketAnchorDecision(pick, _snap)');
check('shadow verdict computed in logger before the live gate', sgAt !== -1 && gateAt !== -1 && sgAt < gateAt);
check('shadow guard reads the fetched book odds fallback', src.includes('if (!_sgBook && pick._marketOdds) _sgBook = pick._marketOdds;'));
check('notes builder appends the shadow block', src.includes('out = appendShadowGuardToNotes(out, pick._shadowGuard);'));
check('shadow function never assigns to the judged pick', !/origPick\.(winner|confidence)\s*=/.test(extractFn('shadowGuardDecision')));

console.log(`shadow-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
