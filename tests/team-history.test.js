// Team history slice + story extraction tests (2026-10-14).
//
// Two changes pinned here:
//  1. extractStoryFromNotes now reads the CURRENT write-up format
//     ("Result: <recap> Pick: ..."), not only the retired
//     "Result: Final: <score>. <story> Pick:" format. The retired-only
//     extractor silently returned "" for every current recap, so the
//     model's TRACK RECORD lines carried final scores but no stories.
//  2. buildTeamHistoryBlock: the track record filtered to the two sides
//     of the matchup being analyzed (Drew's "team slice") — each side's
//     most recent graded appearances, same line format (write-up +
//     private diagnostics) as the general record. Reading material only.

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

const code = ['stripDiacritics', 'matchName', 'namesLooselyMatch', 'looseMatchStrength', 'normalizeConfPct',
  'parseScoreMargin', 'extractFinalScoreFromNotes', 'extractOddsSnapshotFromNotes',
  'privateDiagForRecord', 'extractStoryFromNotes', 'historyLineForRecord',
  'buildTeamHistoryBlock'].map(extractFn).join('\n');
eval(code);

// --- story extraction: current format ---
const magicNotes = "Prediction text. · Result: Orlando buried Cleveland early and never let the Cavaliers up, winning 132-116. Paolo Banchero finished with 24 points and 8 rebounds. Pick: Orlando Magic (52%) — Win.";
const story1 = extractStoryFromNotes(magicNotes);
check('story: current basketball recap returned in full', story1.startsWith('Orlando buried Cleveland early') && story1.includes('Paolo Banchero finished with 24 points'));
check('story: pick tail cut', !story1.includes('Pick:'));

const ufcNotes = "Prediction text. · Result: Brendson Ribeiro won by submission at 1:49 of round 1. Pick: Brendson Ribeiro (51%) — Win.";
check('story: current UFC finish returned', extractStoryFromNotes(ufcNotes) === 'Brendson Ribeiro won by submission at 1:49 of round 1.');

const tennisNotes = "Prediction. · Result: Gabriela Knutson beat Susan Bandecchi, 3-6, 7-6, 7-6. Knutson dropped the opener, then took the last 2 sets. Pick: Gabriela Knutson (82%) — Win.";
check('story: current tennis recap returned', extractStoryFromNotes(tennisNotes).includes('Knutson dropped the opener'));

// --- story extraction: retired format still works, head dropped ---
const oldNotes = "Prediction. · Result: Final: Orlando Magic 132, Cleveland Cavaliers 116. Orlando Magic won by 16. Banchero scored 24 for Orlando Magic. Pick: Orlando Magic (52%) — Win.";
check('story: retired format drops the bare-score head', extractStoryFromNotes(oldNotes) === 'Orlando Magic won by 16. Banchero scored 24 for Orlando Magic.');
check('story: no write-up -> empty', extractStoryFromNotes('plain notes, no result segment') === '');
check('story: empty notes -> empty', extractStoryFromNotes('') === '' && extractStoryFromNotes(null) === '');

// --- team history block ---
function rec(label, picked, result, notes, conf) {
  return { fields: { 'League': 'NBA', 'Bet Label': label, 'Picked Winner': picked, 'Result': result, 'Confidence %': conf == null ? 0.55 : conf, 'Notes': notes || '' } };
}
const records = [
  rec('Celtics vs Cavaliers', 'Boston Celtics', 'Win', magicNotes.replace('Orlando buried', 'Boston handled'), 0.57),
  rec('Celtics vs Knicks', 'Boston Celtics', 'Loss', 'P. · Result: New York Knicks beat Boston Celtics 108-104. Pick: Boston Celtics (57%) — Loss.', 0.57),
  rec('Cavaliers vs Heat', 'Cleveland Cavaliers', 'Win', 'P. · Result: Cleveland Cavaliers beat Miami Heat 121-100. Pick: Cleveland Cavaliers (61%) — Win.', 0.61),
  rec('Lakers vs Suns', 'Los Angeles Lakers', 'Win', 'P. · Result: Los Angeles Lakers beat Phoenix Suns 118-110. Pick: Los Angeles Lakers (55%) — Win.', 0.55),
];
const block = buildTeamHistoryBlock(records, 'Boston Celtics vs Cleveland Cavaliers');
check('team block: header present', block.includes('Team history for this matchup'));
check('team block: full-name hint matches nickname labels', block.includes('Celtics vs Cavaliers') && block.includes('Celtics vs Knicks'));
check('team block: other side section present', block.includes('Cavaliers vs Heat'));
check('team block: unrelated teams excluded', !block.includes('Lakers vs Suns'));
check('team block: story rides along', block.includes('story:'));
check('team block: null hint -> empty', buildTeamHistoryBlock(records, null) === '');
check('team block: hint without vs -> empty', buildTeamHistoryBlock(records, 'Celtics') === '');
check('team block: no matching teams -> empty', buildTeamHistoryBlock(records, 'Denver Nuggets vs Utah Jazz') === '');
check('team block: empty history -> empty', buildTeamHistoryBlock([], 'Michigan State vs Ohio State') === '');

// --- contamination: the strength floor (2026-10-15) ---
// involves() must require looseMatchStrength 2. A last-word-only match
// (strength 1) is how every "... State" team would otherwise pull every
// other "... State" team's games into its section — the shared-generic-word
// mechanism behind the 2026-10-03 wrong-game grades.
const msuHit = rec('Michigan State vs Ohio State', 'Michigan State', 'Win', 'P. · Result: Michigan State beat Ohio State 71-67. Pick: Michigan State (58%) — Win.', 0.58);
const stateNoise1 = rec('Iowa State vs Ball State', 'Iowa State', 'Win', 'P. · Result: Iowa State beat Ball State 80-70. Pick: Iowa State (60%) — Win.', 0.60);
const stateNoise2 = rec('Kansas State vs Florida State', 'Kansas State', 'Win', 'P. · Result: Kansas State beat Florida State 75-72. Pick: Kansas State (57%) — Win.', 0.57);
const stateBlock = buildTeamHistoryBlock([msuHit, stateNoise1, stateNoise2], 'Michigan State vs Ohio State');
check('contamination: correct same-team hit lands', stateBlock.includes('Michigan State vs Ohio State'));
check('contamination: State-vs-State cross-match excluded (Iowa State/Ball State)', !stateBlock.includes('Iowa State vs Ball State'));
check('contamination: State-vs-State cross-match excluded (Kansas State/Florida State)', !stateBlock.includes('Kansas State vs Florida State'));

// Michigan vs Michigan State: each side's section carries its own games and
// neither section picks up a game that shares only the word "State".
const michGame = rec('Michigan vs Iowa State', 'Michigan', 'Win', 'P. · Result: Michigan beat Iowa State 68-64. Pick: Michigan (56%) — Win.', 0.56);
const rivalry = buildTeamHistoryBlock([msuHit, stateNoise1, michGame], 'Michigan vs Michigan State');
check('contamination: Michigan section carries the Michigan game', rivalry.includes('Michigan — most recent') && rivalry.includes('Michigan vs Iowa State'));
check('contamination: Michigan State section carries the Michigan State game', rivalry.includes('Michigan State — most recent') && rivalry.includes('Michigan State vs Ohio State'));
check('contamination: shared-State-only game in neither section', !rivalry.includes('Iowa State vs Ball State'));
check('contamination: last-word-only matcher would have failed this', namesLooselyMatch('Iowa State', 'Michigan State') === true && looseMatchStrength('Iowa State', 'Michigan State') === 1);

// cap: 10 appearances for one side -> exactly 8 lines in its section
const many = [];
for (let i = 0; i < 10; i++) many.push(rec(`Celtics vs Team${i}`, 'Boston Celtics', 'Win', `P. · Result: Boston Celtics won game ${i}. Pick: Boston Celtics (55%) — Win.`));
many.push(rec('Knicks vs Heat', 'New York Knicks', 'Win', ''));
const capped = buildTeamHistoryBlock(many, 'Boston Celtics vs New York Knicks');
const celticsSection = capped.split('Boston Celtics — most recent')[1].split('New York Knicks —')[0];
check('team block: per-side cap is 8', (celticsSection.match(/^- /gm) || []).length === 8);

// private diagnostics ride along on team lines (market anchor flip)
const anchorRec = rec('Suns vs Spurs', 'San Antonio Spurs', 'Win',
  'P. Market anchor: pick follows the market favorite San Antonio Spurs; the sim had Phoenix Suns at 63% (market 41% implied). · Result: San Antonio Spurs beat Phoenix Suns 110-102. Pick: San Antonio Spurs (55%) — Win.', 0.55);
const anchorBlock = buildTeamHistoryBlock([anchorRec], 'Phoenix Suns vs San Antonio Spurs');
check('team block: priv diag rides along', anchorBlock.includes('priv:') && anchorBlock.includes('market_anchor_flip'));

// history line shape
const line = historyLineForRecord(records[0]);
check('history line: league/label/pick/result present', line.startsWith('- NBA | Celtics vs Cavaliers | picked Boston Celtics') && line.includes('| Win'));
check('history line: conf label', line.includes('(57% conf)'));

// wiring: the chat handler passes the matchup hint into the history fetch
check('wiring: fetchPredictionHistory takes matchupHint', src.includes('async function fetchPredictionHistory(env, provider, matchupHint)'));
check('wiring: call site passes extractMatchupHint', src.includes('fetchPredictionHistory(env, actualProvider, extractMatchupHint(message))'));
check('wiring: team block lands in the track record text', src.includes('${recentLines}${teamBlock}${calibrationBlock}'));

console.log(`team-history: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
