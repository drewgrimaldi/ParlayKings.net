// Regression test for the 2026-10-03 wrong-game grading incident:
// "Virginia vs Florida State" was auto-graded against Iowa State vs West Virginia
// ("virginia" is a substring of "west virginia", and "florida state"/"iowa state"
// share only the generic last word "state"), and "Fresno State vs Washington State"
// was graded against Ball State vs Toledo (both sides matched the SAME competitor
// via the shared word "state"). Both real games were unfinished; the grader never
// looked at them. Grading law: a pick grades ONLY against the right game on the
// right date — a weak or ambiguous name match stays Pending.
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
function mkComp(abbr, displayName, shortName, score, winner) {
  return {
    team: { abbreviation: abbr, displayName, shortDisplayName: shortName, name: displayName },
    score: score == null ? null : String(score),
    winner: !!winner,
  };
}
function mkGame(dateISO, state, home, away) {
  return {
    id: 'evt-' + dateISO.slice(0, 10) + '-' + home.abbr,
    competitions: [{
      id: 'cmp-' + dateISO.slice(0, 10) + '-' + home.abbr,
      date: dateISO,
      status: { type: { state } },
      competitors: [mkComp(home.abbr, home.name, home.short, home.score, home.won), mkComp(away.abbr, away.name, away.short, away.score, away.won)],
    }],
  };
}

// NOTE: intentionally NOT eval'd from src — this stub replaces the real fetcher.
async function fetchEspnWithRetry(url) {
  const m = /dates=(\d{8})/.exec(url || '');
  const day = m ? m[1] : '';
  let events = [];
  if (day === '20261003') {
    events = [
      // THE WRONG GAME (final): Iowa State 45, West Virginia 42.
      mkGame('2026-10-03T12:00:00-04:00', 'post',
        { abbr: 'ISU', name: 'Iowa State Cyclones', short: 'Iowa State', score: 45, won: true },
        { abbr: 'WVU', name: 'West Virginia Mountaineers', short: 'West Virginia', score: 42, won: false }),
      // THE REAL GAME (in progress, Q3): Virginia vs Florida State.
      mkGame('2026-10-03T15:30:00-04:00', 'in',
        { abbr: 'FSU', name: 'Florida State Seminoles', short: 'Florida State', score: 17, won: false },
        { abbr: 'UVA', name: 'Virginia Cavaliers', short: 'Virginia', score: 14, won: false }),
      // THE OTHER WRONG GAME (final): Ball State 24, Toledo 39.
      mkGame('2026-10-03T14:00:00-04:00', 'post',
        { abbr: 'BALL', name: 'Ball State Cardinals', short: 'Ball State', score: 24, won: false },
        { abbr: 'TOL', name: 'Toledo Rockets', short: 'Toledo', score: 39, won: true }),
      // THE OTHER REAL GAME (pre-game): Fresno State vs Washington State.
      mkGame('2026-10-03T21:30:00-04:00', 'pre',
        { abbr: 'WSU', name: 'Washington State Cougars', short: 'Washington State', score: null, won: false },
        { abbr: 'FRES', name: 'Fresno State Bulldogs', short: 'Fresno State', score: null, won: false }),
      // A legit strong-match final: Ohio State beat Penn State.
      mkGame('2026-10-03T12:00:00-04:00', 'post',
        { abbr: 'OSU', name: 'Ohio State Buckeyes', short: 'Ohio State', score: 28, won: true },
        { abbr: 'PSU', name: 'Penn State Nittany Lions', short: 'Penn State', score: 21, won: false }),
    ];
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
  // 1. THE REGRESSION, case A: "Virginia vs Florida State" must resolve to the
  //    real (in-progress) game — completed:false — never the wrong final.
  let r = await findFinalResult('NCAAF', 'Virginia', 'Florida State', '2026-10-03');
  eq(r && r.completed, false, 'Virginia/Florida State resolves to real in-progress game, not Iowa State/West Virginia final');
  eq(r && r.winnerName, null, 'no winner taken from the wrong game');

  // 2. THE REGRESSION, case B: "Fresno State vs Washington State" must resolve
  //    to the real (pre-game) game — never Ball State/Toledo.
  r = await findFinalResult('NCAAF', 'Fresno State', 'Washington State', '2026-10-03');
  eq(r && r.completed, false, 'Fresno State/Washington State resolves to real pre-game, not Ball State/Toledo final');
  eq(r && r.winnerName, null, 'no winner taken from the wrong game');

  // 3. Sanity: a legit strong name match on the right date still grades.
  r = await findFinalResult('NCAAF', 'Ohio State', 'Penn State', '2026-10-03');
  eq(r && r.completed, true, 'legit strong match still grades');
  eq(r && r.winnerName, 'Ohio State Buckeyes', 'legit match picks the right winner');

  // 4. Sanity: looseMatchStrength scoring itself.
  eq(looseMatchStrength('Ohio State Buckeyes', 'Ohio State'), 2, 'substring = strong');
  eq(looseMatchStrength('Iowa State', 'Florida State'), 1, 'shared generic last word = weak');
  eq(looseMatchStrength('Toledo Rockets', 'Washington State'), 0, 'unrelated = zero');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
