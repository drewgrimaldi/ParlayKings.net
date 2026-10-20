// Result write-up tests (2026-10-13).
//
// The POSTMORTEM tag system was removed at Drew's order ("this post mortem is
// garbage") and replaced with a plain result write-up: when a pick is graded,
// its Notes get a factual recap of the result with the final score — written
// to read cleanly on the website — and the model's TRACK RECORD history now
// carries recent results WITH final scores instead of a LOSS PATTERNS tag
// rollup. The tag-driven sim adjustments (extraConservatism pull, starter
// lock scale, stricter ERA sample) died with the tags.
//
// The write-up has two layers (Drew's design, 2026-10-13):
//  - PUBLIC story lines: the player performances that decided the game,
//    measured against the players' own season averages (NBA/WNBA first,
//    from ESPN box scores + core-API avgPoints). Facts only, gated so
//    ordinary variance gets no sentence.
//  - PRIVATE diagnostics: AI-language shorthand about what the pick's own
//    inputs looked like (thin data, dummy inputs, stated vs final margin),
//    built at history-load time for the hidden TRACK RECORD context only —
//    never written to the pick, never public.
//
// These tests pin the wording/logic of all of it plus the removal.

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

const code = ['normalizeConfPct', 'parseScoreMargin', 'prettyScoreSummary',
  'formatResultWriteup', 'extractFinalScoreFromNotes', 'recapShortName', 'topScorerPerTeamFromSummary',
  'basketballStoryLines', 'extractStoryFromNotes', 'extractOddsSnapshotFromNotes', 'privateDiagForRecord', 'recapLinescores', 'pickBestTennisComps', 'isBareTennisWriteup', 'replaceBareResultSegment'].map(extractFn).join('\n');
eval(code);

// --- tennis recap candidate selection (2026-10-15) ---
// The scoreboard search can return several copies of one matchup; the
// recap must build from a copy with a winner AND full linescores, never
// abort on a stale winner-only listing (the bare "Winner:" write-up on
// Zverev–de Minaur, graded N/A while ESPN carried the full 6-4, 6-4).
const _mkComp = (name, winner, sets) => ({ athlete: { displayName: name }, winner, linescores: sets.map((v) => ({ value: v })) });
const _emptyCopy = [_mkComp('Alexander Zverev', true, []), _mkComp('Alex de Minaur', false, [])];
const _fullCopy = [_mkComp('Alexander Zverev', true, [6, 6]), _mkComp('Alex de Minaur', false, [4, 4])];
const _noWinner = [_mkComp('Alexander Zverev', false, [6, 6]), _mkComp('Alex de Minaur', false, [4, 4])];
check('tennis: a complete copy beats a winner-only copy, either order', (() => {
  const a = pickBestTennisComps([_emptyCopy, _fullCopy]);
  const b = pickBestTennisComps([_fullCopy, _emptyCopy]);
  return a && a.complete && a.wSets.join() === '6,6' && b && b.complete;
})());
check('tennis: winner-only copies alone are not complete', (() => {
  const p = pickBestTennisComps([_emptyCopy]);
  return p && p.complete === false;
})());
check('tennis: no winner anywhere yields null', pickBestTennisComps([_noWinner]) === null && pickBestTennisComps([]) === null);

// --- write-up wording ---
const loss = formatResultWriteup(
  { 'Picked Winner': 'Detroit Lions', 'Confidence %': 0.58 },
  { scoreSummary: 'Detroit Lions: 24 - Green Bay Packers: 27', winnerName: 'Green Bay Packers' }, 'Loss');
check('team loss: final score in prose form', loss.includes('Final: Detroit Lions 24, Green Bay Packers 27.'));
check('team loss: pick tail with result', loss.includes('Pick: Detroit Lions (58%) — Loss.'));
check('team loss: pick sentence with conf + result', loss.includes('Pick: Detroit Lions (58%) \u2014 Loss.'));
check('team loss: starts with Result:', loss.startsWith('Result: '));

const ufc = formatResultWriteup(
  { 'Picked Winner': 'Melissa Gatto', 'Confidence %': 0.53 },
  { scoreSummary: 'Melissa Gatto: N/A - Loopy Godinez: N/A', winnerName: 'Melissa Gatto' }, 'Win');
check('N/A scores fall back to winner line', ufc.includes('Winner: Melissa Gatto.'));
check('N/A scores: no Final: line', !ufc.includes('Final:'));

const walk = formatResultWriteup(
  { 'Picked Winner': 'Aryna Sabalenka', 'Confidence %': 0.61 },
  { scoreSummary: null, winnerName: 'Iga Swiatek', walkover: true }, 'Push');
check('walkover: names the advancing player', walk.includes('Iga Swiatek won by walkover.'));
check('walkover: graded Push in pick sentence', walk.includes('\u2014 Push.'));

const tie = formatResultWriteup(
  { 'Picked Winner': 'Kansas City Chiefs', 'Confidence %': 0.66 },
  { scoreSummary: 'Kansas City Chiefs: 20 - Buffalo Bills: 20', winnerName: null, isTie: true }, 'Push');
check('tie: finished level', tie.includes('Finished level.'));
check('tie: no won-by sentence', !tie.includes('won by'));

const bare = formatResultWriteup(
  { 'Picked Winner': 'Some Side', 'Confidence %': null },
  { scoreSummary: null, winnerName: null }, 'Win');
check('no result data: still a clean pick line', bare === 'Result: Pick: Some Side \u2014 Win.');

// --- public story lines ---
const withStory = formatResultWriteup(
  { 'Picked Winner': 'Atlanta Hawks', 'Confidence %': 0.57 },
  { scoreSummary: 'Oklahoma City Thunder: 110 - Atlanta Hawks: 104', winnerName: 'Oklahoma City Thunder' },
  'Loss', ['Brooks Barnhizer scored 20 \u2014 18.3 over a season average of 1.7.']);
check('story line sits between final and pick sentence',
  withStory.indexOf('Brooks Barnhizer scored 20') > withStory.indexOf('Final:') &&
  withStory.indexOf('Brooks Barnhizer scored 20') < withStory.indexOf('Pick:'));

const fixtureSummary = {
  boxscore: { players: [
    { team: { displayName: 'Team A' }, statistics: [{ labels: ['MIN', 'PTS', 'REB'],
      athletes: [
        { athlete: { id: '1', displayName: 'Alpha One' }, stats: ['30', '28', '5'] },
        { athlete: { id: '2', displayName: 'Alpha Two' }, stats: ['25', '12', '9'] },
        { athlete: { id: '3', displayName: 'Alpha DNP' }, stats: ['0', '0', '0'], didNotPlay: true },
      ] }] },
    { team: { displayName: 'Team B' }, statistics: [{ labels: ['MIN', 'PTS', 'REB'],
      athletes: [
        { athlete: { id: '4', displayName: 'Beta One' }, stats: ['33', '9', '4'] },
        { athlete: { id: '5', displayName: 'Beta Two' }, stats: ['20', '21', '2'] },
      ] }] },
  ] },
};
const tops = topScorerPerTeamFromSummary(fixtureSummary);
check('top scorer per team extracted', tops.length === 2 && tops[0].name === 'Alpha One' && tops[0].pts === 28 && tops[1].name === 'Beta Two' && tops[1].pts === 21);
check('top scorer: empty summary -> []', topScorerPerTeamFromSummary({}).length === 0 && topScorerPerTeamFromSummary(null).length === 0);

const story = basketballStoryLines(tops, { '1': 17.0, '5': 24.5 });
check('story: over-average sentence', story.some((s) => s.includes('Alpha One scored 28 for the A \u2014 11 over a season average of 17.')));
check('story: small delta gated out', !story.some((s) => s.includes('Beta Two'))); // 21 vs 24.5 = -3.5 < 5
const cold = basketballStoryLines(tops, { '1': 17.0, '5': 30.2 });
check('story: held-to sentence', cold.some((s) => s.includes('Beta Two was held to 21 for the B \u2014 9.2 under a season average of 30.2.')));
check('story: biggest swing first', cold[0].includes('Alpha One'));
check('story: low-average player gated out', basketballStoryLines([{ id: '9', name: 'Bench Guy', pts: 19 }], { '9': 3.1 }).length === 0);
check('story: missing average -> no line', basketballStoryLines(tops, {}).length === 0);

// --- story extraction for TRACK RECORD lines ---
const storyNotes = 'analysis \u00B7 Auto-graded 2026-10-13: Oklahoma City Thunder: 110 - Atlanta Hawks: 104 \u00B7 Result: Final: Oklahoma City Thunder 110, Atlanta Hawks 104. Brooks Barnhizer scored 20 \u2014 18.3 over a season average of 1.7. Pick: Atlanta Hawks (57%) \u2014 Loss.';
check('story extracted from write-up', extractStoryFromNotes(storyNotes) === 'Brooks Barnhizer scored 20 \u2014 18.3 over a season average of 1.7.');
check('story extraction: no write-up -> empty', extractStoryFromNotes('plain notes') === '');
check('story extraction: write-up without story -> empty',
  extractStoryFromNotes('x \u00B7 Result: Final: A 10, B 9. Pick: A (55%) \u2014 Win.') === '');

// --- private diagnostics (AI-language, hidden context only) ---
const thinRec = { fields: {
  'Result': 'Loss', 'Confidence %': 0.74, 'League': 'MLB',
  'Notes': 'trace: opp ace 0.00 ERA, pen 0.00% strike rate, more 0-0-0 lines \u00B7 Auto-graded 2026-10-13: Boston Red Sox: 2 - New York Yankees: 9 \u00B7 Result: Final: Boston Red Sox 2, New York Yankees 9.',
} };
const priv = privateDiagForRecord(thinRec);
check('priv: thin data token', priv.includes('thin_data(zero_stat_lines='));
check('priv: dummy era token', priv.includes('dummy_era_input'));
check('priv: stated vs margin token', priv.includes('stated=74 final_margin=7 result=loss'));
check('priv: prefixed for the hidden line', priv.startsWith(' || priv: '));
check('priv: clean record -> empty', privateDiagForRecord({ fields: { 'Result': 'Win', 'Confidence %': 0.55, 'Notes': 'solid verified inputs throughout' } }) === '');
check('priv: no record -> empty', privateDiagForRecord(null) === '' && privateDiagForRecord({}) === '');
const qbRec = { fields: { 'Result': 'Loss', 'Confidence %': 0.6, 'Notes': 'QB Rating edge; starter currently listed OUT on the report' } };
check('priv: out QB token', privateDiagForRecord(qbRec).includes('out_qb_in_inputs'));

// --- final-score extraction for TRACK RECORD recent lines ---
const notes = 'model analysis text \u00B7 Auto-graded 2026-10-13: Detroit Lions: 24 - Green Bay Packers: 27 \u00B7 Result: Final: Detroit Lions 24, Green Bay Packers 27.';
check('extract: pulls the raw score summary', extractFinalScoreFromNotes(notes) === 'Detroit Lions: 24 - Green Bay Packers: 27');
check('extract: ungraded notes -> empty', extractFinalScoreFromNotes('plain analysis, no grade') === '');
check('extract: N/A scores -> empty', extractFinalScoreFromNotes('x \u00B7 Auto-graded 2026-10-13: A: N/A - B: N/A \u00B7 Result: Winner: A.') === '');
check('extract: empty input -> empty', extractFinalScoreFromNotes('') === '' && extractFinalScoreFromNotes(null) === '');

// --- the old system is gone ---
for (const gone of ['classifyLossReason', 'formatPostmortemLine', 'computeLossPatterns',
  'getPostmortemSimAdjustments', 'rebuildPostmortemCache', 'postmortemTransitions',
  'extractPostmortemTagList', 'POSTMORTEM_TAGS', 'LOSS PATTERNS (hidden context']) {
  check('removed from code: ' + gone, !src.includes(gone));
}
check('prompt no longer references LOSS PATTERNS context',
  !src.includes('CONFIDENCE CALIBRATION, and LOSS PATTERNS'));
check('grader appends the write-up for every graded pick',
  src.includes('formatResultWriteup(f, result, newResult, storyLines)'));
check('grader fetches basketball story lines for NBA/WNBA',
  src.includes('fetchBasketballStoryLines(gradeKey, result.eventId, env)'));
check('story fetch is budget-capped per grade run', src.includes('storyBudget'));
check('history: recent lines carry story + priv',
  src.includes('extractStoryFromNotes(r.fields["Notes"]') && src.includes('privateDiagForRecord(r)'));
check('prompt explains story:/priv: notes', src.includes('priv: diagnostic in shorthand'));
check('grader no longer fetches actual starters for tags',
  !src.includes('fetchActualStarters'));
check('MLB sim: no postmortem starter-lock scale', !src.includes('pm.starterLockScale'));
check('MLB sim: no postmortem ERA strictness', !src.includes('pm.requireMorePitcherSample'));
check('team sim: no postmortem conservatism pull', !src.includes('pmAdj.extraConservatism'));
check('team sim: no Post-mortem note line', !src.includes('Post-mortem (from graded losses'));
check('history: recent lines carry final scores',
  src.includes('extractFinalScoreFromNotes(r.fields["Notes"]') && src.includes('Most recent graded picks (with final scores):'));


// --- bare tennis write-up repair sweep (2026-10-16) ---
const _bareNotes = 'Pred text. \u00B7 Auto-graded 2026-10-16: A: N/A - B: N/A \u00B7 Result: Winner: Daniil Medvedev. Pick: Daniil Medvedev (56%) \u2014 Win.';
check('sweep: detects the bare fallback segment', isBareTennisWriteup(_bareNotes) === true);
check('sweep: a real story is not bare', isBareTennisWriteup('x \u00B7 Result: Medvedev beat Paul in 3 sets. Pick: X (56%) \u2014 Win.') === false);
check('sweep: replacement swaps only the story span', (() => {
  const out = replaceBareResultSegment(_bareNotes, 'Daniil Medvedev beat Tommy Paul in 3 sets, 6-3, 1-6, 6-3.');
  return out === 'Pred text. \u00B7 Auto-graded 2026-10-16: A: N/A - B: N/A \u00B7 Result: Daniil Medvedev beat Tommy Paul in 3 sets, 6-3, 1-6, 6-3. Pick: Daniil Medvedev (56%) \u2014 Win.';
})());
check('sweep: refuses a non-bare segment', replaceBareResultSegment('x \u00B7 Result: Real story here. Pick: X (56%) \u2014 Win.', 'New story.') === null);
check('sweep: refuses a missing pick tail', replaceBareResultSegment('x \u00B7 Result: Winner: X.', 'Story.') === null);
check('sweep: refuses an empty story', replaceBareResultSegment(_bareNotes, '') === null);

console.log(`result-writeup: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
