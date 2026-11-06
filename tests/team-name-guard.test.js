// Team-name guard tests (2026-11-06).
//
// Drew's order after the Wagner vs Miami corruption: on 2026-11-06
// the fetched DraftKings line for Wagner Seahawks vs Miami
// Hurricanes named "Virginia Cavaliers" as the other side (the
// Northeastern vs Virginia game's line, crossed at fetch time), and
// the live market anchor moved the logged pick onto that phantom
// favorite at 98% — twice, across a delete-and-rerun. The guard:
// before the anchor gate or the shadow judge trusts a market
// snapshot, the snapshot's named other side must be the matchup's
// actual other team. A crossed snapshot is unusable; the sim's
// pick stands exactly as generated.

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

eval(extractFn('stripDiacritics'));
eval(extractFn('matchName'));
eval(extractFn('teamNickname'));
eval(extractFn('oddsNameMatches'));
eval(extractFn('splitMatchupSides'));
eval(extractFn('snapshotMatchesMatchup'));
eval(extractFn('marketAnchorDecision'));
eval(extractFn('shadowSnapUsable'));
eval(extractFn('shadowBookQualityOk'));
eval(extractFn('shadowGuardDecision'));

const wagnerPick = { winner: 'Miami Hurricanes', confidence: 60, matchup: 'Wagner Seahawks vs Miami Hurricanes' };
const crossedBook = { bookmakerTitle: 'DraftKings', winnerImplied: 3, otherImplied: 98, otherName: 'Virginia Cavaliers', winnerPrice: 3750, otherPrice: -5000 };
const goodBook = { bookmakerTitle: 'DraftKings', winnerImplied: 3, otherImplied: 98, otherName: 'Wagner Seahawks', winnerPrice: 3750, otherPrice: -5000 };

// --- the guard itself ---
check('crossed snapshot rejected (Wagner case)', snapshotMatchesMatchup(crossedBook, wagnerPick) === false);
check('correct snapshot accepted', snapshotMatchesMatchup(goodBook, wagnerPick) === true);
check('short-form other name accepted', snapshotMatchesMatchup({ ...goodBook, otherName: 'Wagner' }, wagnerPick) === true);
check('no otherName -> guard does not fire', snapshotMatchesMatchup({ winnerImplied: 3, otherImplied: 98 }, wagnerPick) === true);
check('no matchup -> guard does not fire', snapshotMatchesMatchup(crossedBook, { winner: 'Miami Hurricanes' }) === true);
check('null snapshot -> guard does not fire', snapshotMatchesMatchup(null, wagnerPick) === true);
check('winner on the other side: correct name accepted',
  snapshotMatchesMatchup({ ...goodBook, otherName: 'Miami Hurricanes' }, { winner: 'Wagner Seahawks', matchup: 'Wagner Seahawks vs Miami Hurricanes' }) === true);
check('winner on the other side: crossed name rejected',
  snapshotMatchesMatchup(crossedBook, { winner: 'Wagner Seahawks', matchup: 'Wagner Seahawks vs Miami Hurricanes' }) === false);
check('tennis: correct opponent accepted',
  snapshotMatchesMatchup({ otherName: 'Taylor Fritz' }, { winner: 'Carlos Alcaraz', matchup: 'Carlos Alcaraz vs Taylor Fritz' }) === true);
check('tennis: wrong opponent rejected',
  snapshotMatchesMatchup({ otherName: 'Casper Ruud' }, { winner: 'Carlos Alcaraz', matchup: 'Carlos Alcaraz vs Taylor Fritz' }) === false);
check('the pick side itself is not the other side',
  snapshotMatchesMatchup({ ...goodBook, otherName: 'Miami Hurricanes' }, wagnerPick) === false);

// --- live gate composition (the wiring: crossed snap -> gate sees null -> keep) ---
const gatedSnap = snapshotMatchesMatchup(crossedBook, wagnerPick) ? crossedBook : null;
const decGuarded = marketAnchorDecision({ winner: wagnerPick.winner, confidence: 60 }, gatedSnap);
check('guarded gate keeps the sim pick', decGuarded.action === 'keep');
const decUnguarded = marketAnchorDecision({ winner: wagnerPick.winner, confidence: 60 }, crossedBook);
check('unguarded gate would flip to the phantom (proves the test setup)', decUnguarded.action === 'flip' && decUnguarded.favName === 'Virginia Cavaliers');
const decGood = marketAnchorDecision({ winner: wagnerPick.winner, confidence: 60 }, snapshotMatchesMatchup(goodBook, wagnerPick) ? goodBook : null);
check('good snapshot still reaches the gate and flips', decGood.action === 'flip' && decGood.favName === 'Wagner Seahawks');

// --- shadow judge integration ---
const sgCrossed = shadowGuardDecision({ ...wagnerPick }, null, crossedBook);
check('shadow: crossed book dropped -> would-abstain', sgCrossed.verdict === 'would-abstain');
check('shadow: crossed book recorded as dropped', !!(sgCrossed.nameGuard && sgCrossed.nameGuard.book === true));
check('shadow: crossed book not stored as a reference', sgCrossed.book === null);
const sgGood = shadowGuardDecision({ ...wagnerPick }, null, goodBook);
check('shadow: good book judged normally (would-move)', sgGood.verdict === 'would-move' && sgGood.wouldMoveTo === 'Wagner Seahawks');
check('shadow: good book carries no nameGuard', sgGood.nameGuard === undefined);
const sgLegacy = shadowGuardDecision({ winner: 'Miami Hurricanes', confidence: 60 }, null, crossedBook);
check('shadow: no matchup (legacy callers) -> judged as before', sgLegacy.verdict === 'would-move' && sgLegacy.nameGuard === undefined);
const polyCrossed = { winnerImplied: 3, otherImplied: 98, otherName: 'Virginia Cavaliers', anchorQualified: true };
const sgPoly = shadowGuardDecision({ ...wagnerPick }, polyCrossed, null);
check('shadow: crossed qualified Polymarket dropped too', sgPoly.verdict === 'would-abstain' && !!(sgPoly.nameGuard && sgPoly.nameGuard.poly === true) && sgPoly.poly === null);

console.log(`team-name-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
