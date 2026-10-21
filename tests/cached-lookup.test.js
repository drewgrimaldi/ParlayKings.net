// Already-logged fast path tests (2026-10-20 fix).
//
// Drew's order: typing a game that is already logged should spit the
// logged pick out almost instantaneously — in chat, and on a Run All
// second pass, where the runner used to see "logged" and move right on.
// The regression: the September 22 single-model cleanup moved
// fetchCacheCandidateRecords off the KV bets replica onto a live
// Airtable scan (up to 6 pages of full-Notes records) on every chat
// message; the pool narrowing dropped Pending records that were not
// today's; and the serve gate refused any pick not PLACED today, so a
// pick logged yesterday for tonight's game re-ran the full pipeline.
// These tests pin the restored behavior plus the matcher fact that city
// phrasing ("pistons vs boston") already matches the full-name label.

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

for (const fn of ['stripDiacritics', 'matchName', 'teamNickname', 'matchupNicknameKey',
  'splitMatchupSides', 'matchupSideMatches', 'sameMatchup', 'extractMatchupHint']) {
  eval(extractFn(fn));
}

// --- matcher: city / nickname phrasings of the same game match ---
const label = 'Detroit Pistons vs Boston Celtics';
check('matcher: "pistons vs boston" matches the full-name label', sameMatchup(label, extractMatchupHint('pistons vs boston')) === true);
check('matcher: "detroit vs celtics" matches', sameMatchup(label, extractMatchupHint('detroit vs celtics')) === true);
check('matcher: full names match', sameMatchup(label, 'Detroit Pistons vs Boston Celtics') === true);
check('matcher: unrelated matchup does not match', sameMatchup(label, 'Lakers vs Warriors') === false);

// --- candidate source: replica first, Airtable only as fallback ---
const fnStart = src.indexOf('async function fetchCacheCandidateRecords');
check('source: fetchCacheCandidateRecords exists', fnStart !== -1);
const fnBody = src.slice(fnStart, fnStart + 6000);
check('source: replica is read inside the candidate fetch', fnBody.includes('loadBetsReplica(env)'));
check('source: replica read comes before the Airtable fallback', fnBody.indexOf('loadBetsReplica(env)') !== -1 && fnBody.indexOf('loadBetsReplica(env)') < fnBody.indexOf('api.airtable.com'));
check('source: pool keeps Pending records from any placed day', fnBody.includes('String(f["Result"] || "") === "Pending"'));
check('source: pool includes today event/placed records', fnBody.includes('dateKey(f["Event Date"]) === today') && fnBody.includes('dateKey(f["Placed Date"]) === today'));

// --- pool narrowing in checkExistingPrediction keeps Pending ---
check('pool: today-narrowing keeps Pending records', src.includes('records.filter((r) => isToday(r) || String(r.fields["Result"] || "") === "Pending")'));

// --- serve gate: pending any day, or today's game, or placed today ---
check('gate: cachedServable present in the chat handler', src.includes('const cachedServable = cached && ('));
check('gate: pending serves regardless of placed day', src.includes('String(cached.result || "") === "Pending" || dateKey(cached.eventDate) === todayET()'));
check('gate: cachedPickFromRecord carries the result', src.includes('result: f["Result"] || ""'));

console.log(`cached-lookup: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
