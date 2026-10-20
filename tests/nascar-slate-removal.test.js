// NASCAR slate removal (Drew's call 2026-09-23): the daily board-run loop
// (buildDailySlate, "run all") must never touch NASCAR — no real statistical
// data source exists. The single-prediction NASCAR path stays intact.
// Tests the REAL bundle vars extracted from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extractVar(name) {
  const m = src.match(new RegExp('var ' + name + ' = (\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});'));
  if (!m) throw new Error('var missing from bundle: ' + name);
  return eval('(' + m[1] + ')');
}

const SLATE_LEAGUES = extractVar('SLATE_LEAGUES');
const ESPN_LEAGUE_PATHS = extractVar('ESPN_LEAGUE_PATHS');

let fails = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}

console.log('--- NASCAR is off the daily board-run slate ---');
check('NASCAR absent from SLATE_LEAGUES',
  SLATE_LEAGUES.some((l) => l.key === 'NASCAR'), false);

console.log('--- the rest of the board is untouched ---');
const expectedKeys = ['MLB', 'NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'WNBA', 'UFC', 'TENNIS', 'WTA', 'SOCCER'];
check('SLATE_LEAGUES has exactly the expected leagues',
  SLATE_LEAGUES.map((l) => l.key).sort(), expectedKeys.slice().sort());

console.log('--- single-prediction NASCAR path stays intact ---');
check('ESPN_LEAGUE_PATHS.NASCAR still wired for explicit picks',
  ESPN_LEAGUE_PATHS.NASCAR, 'racing/nascar-premier');
check('NASCAR schedule-verification copy still present',
  src.includes('For NASCAR:') && src.includes('get_game_schedule (rule 8) has confirmed both named drivers'), true);

if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('all checks passed');
