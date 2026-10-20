// WTA belongs ON the daily slate (confirmed 2026-10-12): the daily board-run
// loop (buildDailySlate, "run all") fetches tennis/wta alongside ATP
// (the TENNIS entry). A same-day removal (7:02 PM ET) was reversed within
// the hour (7:56 PM ET) — it was never wanted. This test locks the board so
// WTA cannot silently drop off the daily numbers again.
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

console.log('--- WTA is on the daily board-run slate ---');
check('WTA present in SLATE_LEAGUES',
  SLATE_LEAGUES.some((l) => l.key === 'WTA'), true);
check('TENNIS (ATP) present in SLATE_LEAGUES',
  SLATE_LEAGUES.some((l) => l.key === 'TENNIS'), true);

console.log('--- the board is exactly as expected ---');
const expectedKeys = ['MLB', 'NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'WNBA', 'UFC', 'TENNIS', 'WTA', 'SOCCER'];
check('SLATE_LEAGUES has exactly the expected leagues',
  SLATE_LEAGUES.map((l) => l.key).sort(), expectedKeys.slice().sort());

console.log('--- paths intact ---');
check('ESPN_LEAGUE_PATHS.WTA is the WTA path',
  ESPN_LEAGUE_PATHS.WTA, 'tennis/wta');
check('ESPN_LEAGUE_PATHS.TENNIS is the ATP path',
  ESPN_LEAGUE_PATHS.TENNIS, 'tennis/atp');

if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('all checks passed');
