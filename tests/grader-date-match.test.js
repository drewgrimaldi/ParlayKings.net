// Regression test for the 2026-09-24 grader incident:
// ten MLB picks dated 2026-09-24 were auto-graded against 2026-09-23's finals
// (same matchups, series continuing) because findFinalResult's single-candidate
// branch skipped the Event Date check. Grading law: a pick grades ONLY against
// a game whose date matches the pick's Event Date exactly, or it stays Pending.
// Runs under plain node, no dependencies. Tests the REAL findFinalResult by
// extracting it from ../src/index.js (never a copy); the ESPN fetch is stubbed.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

// ESPN_LEAGUE_PATHS is a var, not a function — pull it directly.
const pathsStart = src.indexOf('var ESPN_LEAGUE_PATHS = {');
const pathsEnd = src.indexOf('};', pathsStart) + 2;
eval(src.slice(pathsStart, pathsEnd));

// Minifier helper used inside findFinalResult — identity stub.
function __name22222222222(fn) { return fn; }

for (const fn of ['stripDiacritics', 'matchName', 'namesLooselyMatch', 'looseMatchStrength', 'normalizeLeague', 'findFinalResult']) {
  eval(extract(fn));
}

// ---- Stubbed ESPN scoreboards ----
function mkGame(dateET, state, homeAbbr, homeName, homeScore, awayAbbr, awayName, awayScore, winnerAbbr) {
  const comp = (abbr, name, score) => ({
    team: { abbreviation: abbr, displayName: name, shortDisplayName: name, name },
    score: score == null ? null : String(score),
    winner: abbr === winnerAbbr,
  });
  return {
    id: 'evt-' + dateET.slice(0, 10),
    competitions: [{
      id: 'cmp-' + dateET.slice(0, 10),
      date: dateET,
      status: { type: { state } },
      competitors: [comp(homeAbbr, homeName, homeScore), comp(awayAbbr, awayName, awayScore)],
    }],
  };
}

// NOTE: intentionally NOT eval'd from src — this stub replaces the real fetcher.
async function fetchEspnWithRetry(url) {
  const m = /dates=(\d{8})/.exec(url || '');
  const day = m ? m[1] : '';
  let events = [];
  if (day === '20260923') {
    // Yesterday's FINAL: Mets beat Rangers 7-2.
    events = [mkGame('2026-09-23T20:05:00-04:00', 'post', 'TEX', 'Texas Rangers', 2, 'NYM', 'New York Mets', 7, 'NYM')];
  } else if (day === '20260924' && globalThis.__includeTodayGame) {
    // Today's game: scheduled, not started.
    events = [mkGame('2026-09-24T14:35:00-04:00', 'pre', 'TEX', 'Texas Rangers', null, 'NYM', 'New York Mets', null, null)];
  }
  return { ok: true, json: async () => ({ events }) };
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('ok:', label); }
  else { fail++; console.log('FAIL:', label, '\n  expected:', e, '\n  actual:  ', a); }
}

(async () => {
  // 1. Both games present: today's pick must resolve to TODAY's (unplayed) game,
  //    never yesterday's final.
  globalThis.__includeTodayGame = true;
  let r = await findFinalResult('MLB', 'New York Mets', 'Texas Rangers', '2026-09-24');
  eq(r && r.completed, false, "today's pick resolves to today's unplayed game, not yesterday's final");
  eq(r && r.winnerName, null, 'no winner taken from yesterday when today is unplayed');

  // 2. THE REGRESSION: only yesterday's completed game in the window (single
  //    candidate). Must stay Pending (null) — never grade the wrong date.
  globalThis.__includeTodayGame = false;
  r = await findFinalResult('MLB', 'New York Mets', 'Texas Rangers', '2026-09-24');
  eq(r, null, 'single candidate on wrong date stays Pending (2026-09-24 hole)');

  // 3. Sanity: a date-matched completed game still grades normally.
  r = await findFinalResult('MLB', 'New York Mets', 'Texas Rangers', '2026-09-23');
  eq(r && r.completed, true, 'date-matched final still grades');
  eq(r && r.winnerName, 'New York Mets', 'date-matched final picks the right winner');

  // 4. No candidates at all: stays Pending.
  r = await findFinalResult('MLB', 'New York Mets', 'Texas Rangers', '2026-09-25');
  eq(r, null, 'no candidate on the event date stays Pending');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
