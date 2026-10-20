// Basketball fixes (Drew's call 2026-09-23): OUT-star suppression, neutral-site
// HFA, CBB travel tiers, max-PPG key-player selection, per-league scorer scales.
// Tests the REAL bundle functions extracted from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let p = src.indexOf('(', start), pd = 0, qi = p;
  for (; qi < src.length; qi++) {
    if (src[qi] === '(') pd++;
    if (src[qi] === ')') { pd--; if (!pd) break; }
  }
  let i = src.indexOf('{', qi), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

// travelCoordFor reads the TRAVEL_ABBR_ALIASES var — pull the real one.
eval(src.match(/var TRAVEL_ABBR_ALIASES = \{[^}]*\};/)[0]);

for (const fn of ['isPlayerOut', 'attachRosterInjuries', 'isNeutralVenueEvent',
    'applyBasketballHomeCourt', 'keyPlayerScaleForLeague', 'qbFactorFromValue',
    'sortKeyPlayerPool', 'travelCoordFor', 'haversineMiles', 'travelTierForMiles']) {
  eval(extract(fn));
}

// Extract the REAL CBB table from the bundle's STADIUM_COORDS (brace-matched).
function extractCbbTable() {
  const anchor = src.indexOf('var STADIUM_COORDS');
  const keyIdx = src.indexOf('CBB: {', anchor);
  let i = src.indexOf('{', keyIdx), depth = 0, start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return eval('(' + src.slice(start, i + 1) + ')');
}
const CBB_TABLE = extractCbbTable();

let fails = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}
const r4 = (v) => Math.round(v * 10000) / 10000;
const kpFactor = (ppg, key) => {
  const s = keyPlayerScaleForLeague(key);
  return qbFactorFromValue(ppg, s.leagueAvg, s.scaleDivisor);
};

console.log('--- FIX 1: OUT star must not supply the key-player boost ---');
// attach by athlete id
{
  const players = [{ id: 1, fullName: 'Star Player' }, { id: 2, fullName: 'Role Player' }];
  attachRosterInjuries(players, [{ athlete: { id: 1, displayName: 'Star Player' }, status: 'Out' }]);
  check('attach by id sets injuries', players[0].injuries, [{ status: 'Out' }]);
  check('unmatched player untouched', players[1].injuries, undefined);
  check('OUT star now detected by isPlayerOut', isPlayerOut(players[0]), true);
  check('healthy player not flagged', isPlayerOut(players[1]), false);
}
// attach by display-name fallback
{
  const players = [{ id: 99, displayName: 'Name Only Star' }];
  attachRosterInjuries(players, [{ athlete: { displayName: 'Name Only Star' }, status: 'Out' }]);
  check('attach by name fallback', isPlayerOut(players[0]), true);
}
// never overwrite existing injuries; skip status-less entries
{
  const players = [{ id: 5, injuries: [{ status: 'Questionable' }] }, { id: 6, fullName: 'No Status' }];
  attachRosterInjuries(players, [
    { athlete: { id: 5 }, status: 'Out' },
    { athlete: { id: 6, displayName: 'No Status' }, status: '' },
  ]);
  check('existing injuries not overwritten', players[0].injuries, [{ status: 'Questionable' }]);
  check('status-less entry skipped', players[1].injuries, undefined);
}
// isPlayerOut status semantics (only true OUTs suppress; Q/DGT keep the haircut path)
check('isPlayerOut: Out', isPlayerOut({ injuries: [{ status: 'Out' }] }), true);
check('isPlayerOut: Injured Reserve', isPlayerOut({ injuries: [{ status: 'Injured Reserve' }] }), true);
check('isPlayerOut: IR', isPlayerOut({ injuries: [{ status: 'IR' }] }), true);
check('isPlayerOut: Questionable is NOT out', isPlayerOut({ injuries: [{ status: 'Questionable' }] }), false);
check('isPlayerOut: Day-To-Day is NOT out', isPlayerOut({ injuries: [{ status: 'Day-To-Day' }] }), false);
check('isPlayerOut: no injuries field', isPlayerOut({ id: 1 }), false);
// The suppression branch in getKeyPlayerFactor: `const out = isPlayerOut(top.player);
// if (!out) { factor = ... }` — an OUT star must leave factor at neutral 1.
{
  const top = { player: { id: 7, fullName: 'Out Star' } };
  attachRosterInjuries([top.player], [{ athlete: { id: 7 }, status: 'Out' }]);
  const out = isPlayerOut(top.player);
  let factor = 1;
  if (!out) factor = 9.99; // would-be boost; must not run
  check('OUT star suppression branch leaves factor neutral', out === true && factor === 1, true);
}

console.log('--- FIX 2: neutral venue = 0 home-court points ---');
check('neutralSite flag detected', isNeutralVenueEvent({ competitions: [{ neutralSite: true, competitors: [] }] }, 'home'), true);
check('both competitors neutral detected', isNeutralVenueEvent({ competitions: [{ competitors: [{ homeAway: 'neutral' }, { homeAway: 'neutral' }] }] }, 'neutral'), true);
check('compHomeAway neutral string detected', isNeutralVenueEvent({ competitions: [{}] }, 'neutral'), true);
check('normal home/away not neutral', isNeutralVenueEvent({ competitions: [{ competitors: [{ homeAway: 'home' }, { homeAway: 'away' }] }] }, 'home'), false);
{
  const cA = {}, cB = {};
  const line = applyBasketballHomeCourt(cA, cB, { neutralSite: true, homeTeamIsA: false }, 'CBB', 'Duke');
  check('neutral CBB: no HFA on A', cA.homeFieldPts, undefined);
  check('neutral CBB: no HFA on B', cB.homeFieldPts, undefined);
  check('neutral: both travel tiers medium', [cA.travelTier, cB.travelTier], ['medium', 'medium']);
  check('neutral: trace line mentions neutral', /neutral/i.test(line), true);
}
{
  const cA = {}, cB = {};
  applyBasketballHomeCourt(cA, cB, { neutralSite: false, homeTeamIsA: true }, 'CBB', 'Duke');
  check('home CBB: +4 to home side', cA.homeFieldPts, 4);
  check('home CBB: nothing to away side', cB.homeFieldPts, undefined);
}
{
  const cA = {}, cB = {};
  applyBasketballHomeCourt(cA, cB, { neutralSite: false, homeTeamIsA: false }, 'NBA', 'Celtics');
  check('away NBA: +3 to teamB', cB.homeFieldPts, 3);
  check('away NBA: nothing to teamA', cA.homeFieldPts, undefined);
}

console.log('--- FIX 3: CBB travel uses real distance tiers ---');
check('sport-path mapping wires CBB', src.includes('"basketball/mens-college-basketball": "CBB"'), true);
check('CBB table has DUKE', Array.isArray(CBB_TABLE.DUKE) && CBB_TABLE.DUKE.length === 2, true);
check('CBB table has GONZ', Array.isArray(CBB_TABLE.GONZ) && CBB_TABLE.GONZ.length === 2, true);
check('travelCoordFor resolves DUKE', travelCoordFor(CBB_TABLE, 'DUKE'), CBB_TABLE.DUKE);
{
  const duke = travelCoordFor(CBB_TABLE, 'DUKE');
  const unc = travelCoordFor(CBB_TABLE, 'UNC');
  const gonz = travelCoordFor(CBB_TABLE, 'GONZ');
  const shortMi = haversineMiles(duke[0], duke[1], unc[0], unc[1]);
  const longMi = haversineMiles(duke[0], duke[1], gonz[0], gonz[1]);
  check('Duke-UNC is a short trip', shortMi < 200, true);
  check('Duke-Gonzaga is a long trip', longMi > 1500, true);
  check('short trip tier', travelTierForMiles(shortMi), 'short');
  check('long trip tier', travelTierForMiles(longMi), 'long');
  check('mid trip tier', travelTierForMiles(800), 'medium');
}
check('unlisted program fails open to null', travelCoordFor(CBB_TABLE, 'ZZZNOTATEAM'), null);

console.log('--- FIX 4: key-player selection is max-PPG, not max-gamesPlayed ---');
{
  const pool = [
    { player: { fullName: 'Ironman' }, usage: 30, val: 12 },
    { player: { fullName: 'Star' }, usage: 20, val: 28 },
  ];
  sortKeyPlayerPool(pool, 'NBA');
  check('NBA picks the 28-PPG star over the 30-game ironman', pool[0].player.fullName, 'Star');
}
{
  const pool = [
    { player: { fullName: 'Ironman' }, usage: 30, val: 12 },
    { player: { fullName: 'Star' }, usage: 20, val: 28 },
  ];
  sortKeyPlayerPool(pool, 'CBB');
  check('CBB picks the scorer too', pool[0].player.fullName, 'Star');
}
{
  const pool = [
    { player: { fullName: 'Backup' }, usage: 200, val: 95 },
    { player: { fullName: 'Starter' }, usage: 400, val: 90 },
  ];
  sortKeyPlayerPool(pool, 'NFL');
  check('NFL still sorts by usage (real starter)', pool[0].player.fullName, 'Starter');
}

console.log('--- FIX 5: per-league scorer scales differentiate ---');
check('NBA scale unchanged', keyPlayerScaleForLeague('NBA'), { leagueAvg: 18, scaleDivisor: 40, statLabel: 'PPG' });
check('WNBA scale', keyPlayerScaleForLeague('WNBA'), { leagueAvg: 13, scaleDivisor: 29, statLabel: 'PPG' });
check('CBB scale', keyPlayerScaleForLeague('CBB'), { leagueAvg: 11, scaleDivisor: 25, statLabel: 'PPG' });
check('avg NBA starter neutral', r4(kpFactor(18, 'NBA')), 1);
check('avg WNBA starter neutral', r4(kpFactor(13, 'WNBA')), 1);
check('avg CBB starter neutral', r4(kpFactor(11, 'CBB')), 1);
check('NBA elite 30ppg hits clamp', r4(kpFactor(30, 'NBA')), 1.25);
check('WNBA elite 23ppg hits clamp like NBA elite', r4(kpFactor(23, 'WNBA')), 1.25);
check('CBB 20ppg star differentiates upward', r4(kpFactor(20, 'CBB')) > 1.2, true);
// Regression: the old single (18,40) scale graded a good CBB scorer BELOW average.
check('CBB 15ppg now boosts (old scale gave 0.925)', r4(kpFactor(15, 'CBB')), 1.16);
check('WNBA 18ppg star no longer near-flat', r4(kpFactor(18, 'WNBA')) > 1.15, true);
check('monotonic in PPG', kpFactor(25, 'CBB') > kpFactor(15, 'CBB') && kpFactor(15, 'CBB') > kpFactor(8, 'CBB'), true);
check('getKeyPlayerFactor uses per-league scale', src.includes('keyPlayerScaleForLeague(key)'), true);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
