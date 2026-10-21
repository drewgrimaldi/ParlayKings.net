// Learned patterns (the learner) tests (2026-10-20).
//
// Pins computeLearnedPatterns / marketStanceForRecord: the block that
// measures the model's own graded record by the position it stood in on
// each pick — sided with the market, dissented (by price band and by
// claimed edge), moved by the market fallback, or carrying a
// data-quality diagnostic — and feeds the measured hit rates back into
// the hidden track-record context of future predictions. Context only:
// these tests also pin that the block moves no number and that the
// market fallback, calibration, and sim wiring are untouched.

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
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const code = ['normalizeConfPct', 'extractOddsSnapshotFromNotes', 'extractFinalScoreFromNotes',
  'parseScoreMargin', 'privateDiagForRecord', 'extractStoryFromNotes', 'marketStanceForRecord',
  'tightCapForLeague', 'computeLearnedPatterns'].map(extractFn).join('\n');
eval(code);

function rec(result, notes, conf, league) {
  return { fields: { 'Result': result, 'Notes': notes, 'Confidence %': conf, 'League': league || 'NFL', 'Bet Label': 'A vs B', 'Picked Winner': 'A' } };
}
function oddsNotes(impl) {
  return 'Writeup text. ---ODDSLINE---\n' + JSON.stringify({ winnerPrice: -110, winnerImplied: impl, loserPrice: -110, loserImplied: 100 - impl });
}
const anchorNotes = 'Market anchor: pick follows the market favorite Boston Celtics (53% implied); the sim had Detroit Pistons at 68% (market 32% implied). Writeup.';

// --- marketStanceForRecord classification ---
check('stance: implied >= 50 is sided', marketStanceForRecord(rec('Win', oddsNotes(60), 0.6)).kind === 'sided');
check('stance: implied < 50 is dissent with gap', (() => { const s = marketStanceForRecord(rec('Win', oddsNotes(30), 0.55)); return s.kind === 'dissent' && s.impl === 30 && s.gap === 25; })());
check('stance: anchor note wins over snapshot', marketStanceForRecord(rec('Win', anchorNotes + ' ' + oddsNotes(60), 0.53)).kind === 'anchor');
check('stance: no snapshot returns null', marketStanceForRecord(rec('Win', 'plain writeup, no market stored', 0.6)) === null);

// --- segment math on synthetic records ---
const records = [];
for (let i = 0; i < 6; i++) records.push(rec('Win', oddsNotes(60), 0.6));
for (let i = 0; i < 4; i++) records.push(rec('Loss', oddsNotes(60), 0.6));
for (let i = 0; i < 5; i++) records.push(rec('Win', anchorNotes, 0.53, 'NBA'));
records.push(rec('Loss', anchorNotes, 0.53, 'NBA'));
records.push(rec('Win', oddsNotes(30), 0.55, 'NCAAF'));
for (let i = 0; i < 4; i++) records.push(rec('Loss', oddsNotes(30), 0.55, 'NCAAF'));
for (let i = 0; i < 3; i++) records.push(rec('Win', oddsNotes(47), 0.52, 'NHL'));
for (let i = 0; i < 2; i++) records.push(rec('Loss', oddsNotes(47), 0.52, 'NHL'));
for (let i = 0; i < 2; i++) records.push(rec('Win', 'Record built on preseason stats used in the sim.', 0.55, 'NBA'));
for (let i = 0; i < 3; i++) records.push(rec('Loss', 'Record built on preseason stats used in the sim.', 0.55, 'NBA'));
for (let i = 0; i < 3; i++) records.push(rec('Win', oddsNotes(40), 0.5, 'MLB')); // 35-44 band, n=3: must be suppressed

const block = computeLearnedPatterns(records);
check('block: header names the classified count', block.includes('LEARNED PATTERNS') && block.includes('29 of those picks classified'));
check('block: sided line 60% (6-4, n=10), small-sample flagged', block.includes('Picks that sided with the market favorite: hit 60% (6-4, n=10) (small sample, weigh lightly)'));
check('block: fallback-moved line 83% (5-1, n=6)', block.includes('Picks the market fallback moved to the favorite: hit 83% (5-1, n=6)'));
check('block: deep dissents line 20% (1-4, n=5)', block.includes('your side priced under 35% implied: hit 20% (1-4, n=5)'));
check('block: near-even dissents line 60% (3-2, n=5)', block.includes('your side priced 45-49% implied: hit 60% (3-2, n=5)'));
check('block: claimed-edge over-20 line 20% (1-4, n=5)', block.includes('claimed edge over the market was over 20 points: hit 20% (1-4, n=5)'));
check('block: claimed-edge <=10 line 75% (6-2, n=8) incl. MLB gap-10 dissents', block.includes('claimed edge over the market was 10 or less points: hit 75% (6-2, n=8)'));
check('block: dissents by league (NCAAF)', block.includes('Dissents in NCAAF: hit 20% (1-4, n=5)'));
check('block: preseason-stats diagnostic line 40% (2-3, n=5)', block.includes('Picks with preseason stats used in the sim: hit 40% (2-3, n=5)'));
check('block: segment under n=5 is suppressed (35-44 band)', !block.includes('35-44% implied'));
check('block: closing instruction present, no number moved', block.includes('changes no number by itself'));

// --- summary-mined segments: the learner reads the result stories ---
function storyRec(result, scoreLine, story, league) {
  const notes = `Prediction text. Auto-graded 2026-10-20: ${scoreLine} \u00B7 Result: ${story} Pick: Alpha (55%) \u2014 ${result}.`;
  return { fields: { 'Result': result, 'Notes': notes, 'Confidence %': 0.55, 'League': league || 'NBA', 'Bet Label': 'Alpha vs Beta', 'Picked Winner': 'Alpha' } };
}
const storyRecords = [];
for (let i = 0; i < 2; i++) storyRecords.push(storyRec('Win', 'Alpha: 120 - Beta: 112', 'Alpha rallied from 17 down in the fourth quarter and beat Beta.'));
for (let i = 0; i < 3; i++) storyRecords.push(storyRec('Loss', 'Alpha: 120 - Beta: 112', 'Beta rallied from 17 down in the fourth quarter and beat Alpha.'));
for (let i = 0; i < 4; i++) storyRecords.push(storyRec('Win', 'Alpha: 130 - Beta: 100', 'Alpha dismantled Beta from the opening tip and never trailed.'));
storyRecords.push(storyRec('Loss', 'Alpha: 130 - Beta: 100', 'Beta dismantled Alpha from the opening tip and never trailed.'));
storyRecords.push(storyRec('Win', 'Alpha: 118 - Beta: 110', 'Alpha outlasted Beta in overtime.'));
for (let i = 0; i < 4; i++) storyRecords.push(storyRec('Loss', 'Alpha: 118 - Beta: 110', 'Beta outlasted Alpha in overtime.'));
for (let i = 0; i < 3; i++) storyRecords.push(storyRec('Win', 'Alpha: 115 - Beta: 105', 'Gamma scored 34 for Alpha \u2014 12.5 over a season average of 21.5.'));
for (let i = 0; i < 2; i++) storyRecords.push(storyRec('Loss', 'Alpha: 115 - Beta: 105', 'Gamma scored 34 for Beta \u2014 12.5 over a season average of 21.5.'));
for (let i = 0; i < 2; i++) storyRecords.push(storyRec('Win', 'Alpha: 24 - Beta: 21', 'Alpha held on late to beat Beta.', 'NFL'));
for (let i = 0; i < 3; i++) storyRecords.push(storyRec('Loss', 'Alpha: 24 - Beta: 21', 'Beta held on late to beat Alpha.', 'NFL'));
const storyBlock = computeLearnedPatterns(storyRecords);
check('story: comeback line 40% (2-3, n=5)', storyBlock.includes('turned on a double-digit comeback: hit 40% (2-3, n=5)'));
check('story: rout line 80% (4-1, n=5)', storyBlock.includes('became routs (decided by 25 or more): hit 80% (4-1, n=5)'));
check('story: past-regulation line 20% (1-4, n=5)', storyBlock.includes('went past regulation: hit 20% (1-4, n=5)'));
check('story: star-over-average line 60% (3-2, n=5)', storyBlock.includes('beat his season average by 10 or more: hit 60% (3-2, n=5)'));
check('story: tight-finish line 40% (2-3, n=5)', storyBlock.includes('tight finishes (inside the league\u2019s one-score margin): hit 40% (2-3, n=5)') || storyBlock.includes("tight finishes (inside the league's one-score margin): hit 40% (2-3, n=5)"));
check('tightCap: points leagues 5, NHL/Soccer 1, MLB 2, UFC null', tightCapForLeague('NBA') === 5 && tightCapForLeague('NHL') === 1 && tightCapForLeague('MLB') === 2 && tightCapForLeague('UFC') === null);

// --- empty / unclassifiable inputs ---
check('empty input returns empty string', computeLearnedPatterns([]) === '');
check('no market, no diagnostics returns empty string', computeLearnedPatterns([rec('Win', 'plain writeup', 0.6), rec('Loss', 'plain writeup', 0.6)]) === '');
check('pending records are ignored', computeLearnedPatterns([rec('Pending', oddsNotes(60), 0.6)]) === '');

// --- wiring guards: context assembly carries the block; the rest is untouched ---
check('wiring: fetchPredictionHistory computes the block', src.includes('const learnedBlock = computeLearnedPatterns(records);'));
check('wiring: block appended to the track-record text', src.includes('${recentFormBlock}${learnedBlock}'));
check('wiring: market fallback gate still present', src.includes('function marketAnchorDecision('));
check('wiring: band calibration still fitted from the same records', src.includes('const calibrationParams = fitBandCalibration(records);'));

console.log(`learned-patterns: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
