// Polymarket record tests (2026-10-16).
//
// Drew's order: store the Polymarket price on the record first and
// measure it — the same treatment the sportsbook odds got on
// 2026-10-15. The price is bookkeeping, not an input: no picking,
// calibration, or anchor path reads it (the anchor keeps reading
// only the reply-text sportsbook line). Strict matching only
// (grading-law style): exact "A vs B" event title for this matchup,
// ET date equal to the pick's date, and a moneyline market whose
// outcomes are those two teams. Anything else returns null and
// nothing is stored.

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
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function ' + name);
}

eval(extractFn('polymarketTeamKey'));
eval(extractFn('polymarketTitleSideKey'));
eval(extractFn('polymarketEventDateET'));
eval(extractFn('evaluatePolymarketLiquidityGate'));
eval(extractFn('polymarketTeamKeysMatch'));
eval(src.match(/const POLYMARKET_NAME_DISTINGUISHERS[^;]+;/)[0].replace('const POLYMARKET_NAME_DISTINGUISHERS', 'globalThis.POLYMARKET_NAME_DISTINGUISHERS'));
eval(extractFn('polymarketSnapFromEvent'));
eval(extractFn('polymarketDayWindow'));
eval(extractFn('appendPolymarketSnapshotToNotes'));

const GAME = {
  title: 'Buffalo Bills vs. Miami Dolphins',
  slug: 'nfl-buf-mia-2026-10-18',
  startDate: '2026-10-07T14:23:00Z',
  endDate: '2026-10-18T17:00:00Z',
  markets: [
    { sportsMarketType: 'spread', outcomes: '["Buffalo Bills","Miami Dolphins"]', outcomePrices: '["0.5","0.5"]' },
    { sportsMarketType: 'moneyline', outcomes: '["Buffalo Bills","Miami Dolphins"]', outcomePrices: '["0.62","0.38"]' }
  ]
};

// --- matcher ---
const s1 = polymarketSnapFromEvent(GAME, 'Buffalo Bills', 'Miami Dolphins', 'Buffalo Bills', '2026-10-18');
check('moneyline snap for the favorite', !!s1 && s1.winnerImplied === 62 && s1.otherImplied === 38 && s1.otherName === 'Miami Dolphins' && s1.source === 'Polymarket');
const s2 = polymarketSnapFromEvent(GAME, 'Buffalo Bills', 'Miami Dolphins', 'Miami Dolphins', '2026-10-18');
check('snap orients to the picked side', !!s2 && s2.winnerImplied === 38 && s2.otherImplied === 62 && s2.otherName === 'Buffalo Bills');
check('reversed matchup order still matches', !!polymarketSnapFromEvent(GAME, 'Miami Dolphins', 'Buffalo Bills', 'Buffalo Bills', '2026-10-18'));
check('wrong ET date rejected', polymarketSnapFromEvent(GAME, 'Buffalo Bills', 'Miami Dolphins', 'Buffalo Bills', '2026-10-19') === null);
check('prop-suffixed title rejected', polymarketSnapFromEvent({ ...GAME, title: 'Buffalo Bills vs. Miami Dolphins - First Touchdown Scorer' }, 'Buffalo Bills', 'Miami Dolphins', 'Buffalo Bills', '2026-10-18') === null);
check('different opponent rejected', polymarketSnapFromEvent(GAME, 'Buffalo Bills', 'New York Jets', 'Buffalo Bills', '2026-10-18') === null);
check('winner not in outcomes rejected', polymarketSnapFromEvent(GAME, 'Buffalo Bills', 'Miami Dolphins', 'New York Jets', '2026-10-18') === null);
const noMl = { ...GAME, markets: [{ outcomes: '["Buffalo Bills","Miami Dolphins"]', outcomePrices: '["0.55","0.45"]' }] };
const s3 = polymarketSnapFromEvent(noMl, 'Buffalo Bills', 'Miami Dolphins', 'Buffalo Bills', '2026-10-18');
check('two-outcome fallback market accepted', !!s3 && s3.winnerImplied === 55);
check('late-night UTC start maps to same ET date', polymarketEventDateET({ startDate: '2026-10-19T01:00:00Z' }) === '2026-10-18');



// --- the anchor gate is gone (2026-10-19): snaps inform, never override ---

// --- storage ---
const notes = appendPolymarketSnapshotToNotes('notes', s1);
check('POLYLINE stores winner orientation + slug', notes.includes('---POLYLINE---') && notes.includes('"winnerImplied":62') && notes.includes('nfl-buf-mia-2026-10-18'));

// --- wiring in the bundle ---
check('logger stashes the Polymarket price at logging time', src.includes('await fetchPolymarketSnap(env, pick)') && src.includes('polymarket stash failed'));
check('no anchor gate remains in the logger', !src.includes('marketAnchorDecision(pick, _snap)') && !src.includes('pick._anchorFlip = {'));
check('market info block is built for the model before it decides', src.includes('marketBlock = await buildMarketInfoBlock(env, message'));
check('info block shows only liquidity-qualified prices', src.includes('snap && snap.anchorQualified'));
check('polyline stored on every pick (re-oriented + marked on flips)', src.includes('const poly = flipped ? reorientSnapshotForFlip(pick._polymarket, pick._anchorFlip) : pick._polymarket;'));
check('series map covers the slate leagues', src.includes('NFL: [12185]') && src.includes('NCAAF: [12756]') && src.includes('WNBA: [10105]') && src.includes('UFC: [38]') && src.includes('TENNIS: [10365, 10366]'));
check('fetch fails open to null', src.includes('polymarket fetch failed'));

// --- 2026-10-17 matcher repair: the date is the GAME's date (endDate) ---
check('endDate carries the game date', polymarketEventDateET(GAME) === '2026-10-18');
const LATE = { title: 'Buffalo Bills vs. Miami Dolphins', slug: 'x', startDate: '2026-10-07T14:23:00Z', endDate: '2026-10-19T02:30:00Z', markets: GAME.markets };
check('late ET kickoff (02:30Z) still dates to the ET game day', polymarketEventDateET(LATE) === '2026-10-18');
const CREATED_ON_GAMEDAY = { title: 'Buffalo Bills vs. Miami Dolphins', slug: 'y', startDate: '2026-10-18T09:00:00Z', endDate: '2026-10-25T17:00:00Z', markets: GAME.markets };
check('creation-date coincidence does NOT match (endDate rules)', polymarketSnapFromEvent(CREATED_ON_GAMEDAY, 'Buffalo Bills', 'Miami Dolphins', 'Buffalo Bills', '2026-10-18') === null);
const wk = polymarketDayWindow('2026-10-18');
check('day window covers the ET day', !!wk && wk.min <= '2026-10-18T04:00:00.000Z' && wk.max >= '2026-10-19T04:00:00.000Z');
check('day window stays bounded (<=36h)', !!wk && (Date.parse(wk.max) - Date.parse(wk.min)) <= 36 * 3600 * 1000);

// --- 2026-10-17 repair II: mascot tails match, distinguisher tails never do ---
check('mascot tail matches (Buckeyes)', polymarketTeamKeysMatch('ohio state', 'ohio state buckeyes'));
check('mascot tail matches reversed (Minutemen)', polymarketTeamKeysMatch('massachusetts minutemen', 'massachusetts'));
check('two-word mascot matches (Crimson Tide)', polymarketTeamKeysMatch('alabama', 'alabama crimson tide'));
check('Michigan does NOT match Michigan State', !polymarketTeamKeysMatch('michigan', 'michigan state spartans'));
check('Texas does NOT match Texas A&M', !polymarketTeamKeysMatch('texas', 'texas a&m aggies'));
check('Georgia does NOT match Georgia Tech', !polymarketTeamKeysMatch('georgia', 'georgia tech yellow jackets'));
check('Florida does NOT match Florida Atlantic', !polymarketTeamKeysMatch('florida', 'florida atlantic owls'));
check('Virginia does NOT match Virginia Tech', !polymarketTeamKeysMatch('virginia', 'virginia tech hokies'));
const MASCOT_GAME = { title: 'Ohio State vs. Indiana', slug: 'cfb-osu-ind-2026-10-17', startDate: '2026-10-06T00:12:50Z', endDate: '2026-10-17T16:00:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Ohio State","Indiana"]', outcomePrices: '["0.83","0.17"]', volumeNum: 220000, liquidityNum: 380000, spread: 0.01, active: true, closed: false, acceptingOrders: true } ] };
const ms = polymarketSnapFromEvent(MASCOT_GAME, 'Ohio State Buckeyes', 'Indiana Hoosiers', 'Ohio State Buckeyes', '2026-10-17');
check('mascot matchup snaps end to end', !!ms && ms.winnerImplied === 83 && ms.otherName === 'Indiana' && ms.anchorQualified === true);

// --- 2026-10-17 repair VI: decorated series titles (UFC) ---
const UFC_MAIN = { title: 'UFC Fight Night: Mike Malott vs. Joaquin Buckley (Welterweight, Main Card)', slug: 'ufc-mik9-joa3-2026-10-17', startDate: '2026-10-03T13:37:07Z', endDate: '2026-10-18T00:00:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Mike Malott","Joaquin Buckley"]', outcomePrices: '["0.545","0.455"]', volumeNum: 112703, liquidityNum: 148265, spread: 0.01, active: true, closed: false, acceptingOrders: true } ] };
const us = polymarketSnapFromEvent(UFC_MAIN, 'Joaquin Buckley', 'Mike Malott', 'Mike Malott', '2026-10-17');
check('UFC decorated title snaps end to end', !!us && us.winnerImplied === 54.5 && us.otherName === 'Joaquin Buckley');
check('UFC main-card market qualifies at real volume', !!us && us.anchorQualified === true);
check('UFC title for a different pair does NOT snap', polymarketSnapFromEvent(UFC_MAIN, 'Erin Blanchfield', 'Jasmine Jasudavicius', 'Erin Blanchfield', '2026-10-17') === null);
const UFC_ACCENT = { title: 'UFC Fight Night: Kyle Nelson vs. Cristian Pérez (Lightweight, Main Card)', slug: 'ufc-kyl1-cri4-2026-10-17', startDate: '2026-10-03T00:00:00Z', endDate: '2026-10-18T00:00:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Kyle Nelson","Cristian Pérez"]', outcomePrices: '["0.62","0.38"]', volumeNum: 42000, liquidityNum: 61000, spread: 0.01, active: true, closed: false, acceptingOrders: true } ] };
const ua = polymarketSnapFromEvent(UFC_ACCENT, 'Kyle Nelson', 'Cristian Perez', 'Cristian Perez', '2026-10-17');
check('accented fighter name matches unaccented slate label', !!ua && ua.winnerImplied === 38);
check('title side key strips prefix + parenthetical', polymarketTitleSideKey('UFC Fight Night: Mike Malott') === 'mike malott' && polymarketTitleSideKey('Joaquin Buckley (Welterweight, Main Card)') === 'joaquin buckley');

// --- 2026-10-18 repair VIII: pro series title by NICKNAME only ---
// Live Gamma shape (verified 2026-10-18): NFL/NHL event titles AND
// moneyline outcomes carry nicknames only ("Cowboys vs. Packers",
// outcomes ["Cowboys","Packers"]) while picks carry full ESPN names
// ("Dallas Cowboys"). The mascot-tail rule alone matched none of them:
// NFL and NHL logged zero snapshots on 2026-10-18. The city-head rule
// bridges a dropped place name; distinguisher heads stay blocked.
check('city head matches (Cowboys)', polymarketTeamKeysMatch('dallas cowboys', 'cowboys'));
check('city head matches reversed (Packers)', polymarketTeamKeysMatch('packers', 'green bay packers'));
check('two-word city head matches (49ers)', polymarketTeamKeysMatch('san francisco 49ers', '49ers'));
check('city head matches (Hurricanes)', polymarketTeamKeysMatch('carolina hurricanes', 'hurricanes'));
check('Kansas City head matches (Chiefs)', polymarketTeamKeysMatch('kansas city chiefs', 'chiefs'));
check('two-word nickname suffix matches (Maple Leafs)', polymarketTeamKeysMatch('toronto maple leafs', 'maple leafs'));
check('distinguisher head does NOT match (Buckeyes)', !polymarketTeamKeysMatch('ohio state buckeyes', 'buckeyes'));
check('nickname does NOT match a different team (Rangers/Islanders)', !polymarketTeamKeysMatch('new york rangers', 'islanders'));
// Real live shapes: tomorrow's MNF market and today's SNF market.
const MNF = { title: 'Commanders vs. 49ers', slug: 'nfl-was-sf-2026-10-19', startDate: '2026-10-08T00:00:00Z', endDate: '2026-10-20T00:15:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Commanders","49ers"]', outcomePrices: '["0.215","0.785"]', volumeNum: 11837, liquidityNum: 795060, spread: 0.01, active: true, closed: false, acceptingOrders: true } ] };
const mnf = polymarketSnapFromEvent(MNF, 'Washington Commanders', 'San Francisco 49ers', 'San Francisco 49ers', '2026-10-19');
check('nickname-only NFL event snaps end to end', !!mnf && mnf.winnerImplied === 78.5 && mnf.otherName === 'Commanders' && mnf.anchorQualified === true);
const SNF = { title: 'Cowboys vs. Packers', slug: 'nfl-dal-gb-2026-10-18', startDate: '2026-10-07T14:23:00Z', endDate: '2026-10-19T00:20:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Cowboys","Packers"]', outcomePrices: '["0.195","0.805"]', volumeNum: 2191461, liquidityNum: 584532, spread: 0.01, active: true, closed: false, acceptingOrders: true } ] };
const snf = polymarketSnapFromEvent(SNF, 'Dallas Cowboys', 'Green Bay Packers', 'Green Bay Packers', '2026-10-18');
check('nickname-only SNF event snaps on its ET date', !!snf && snf.winnerImplied === 80.5 && snf.anchorQualified === true);
const NHL1 = { title: 'Hurricanes vs. Flames', slug: 'nhl-car-cgy-2026-10-18', startDate: '2026-10-08T00:00:00Z', endDate: '2026-10-19T00:00:00Z', markets: [ { sportsMarketType: 'moneyline', outcomes: '["Hurricanes","Flames"]', outcomePrices: '["0.36","0.64"]', volumeNum: 160468, liquidityNum: 16067, spread: 0.02, active: true, closed: false, acceptingOrders: true } ] };
const nhl = polymarketSnapFromEvent(NHL1, 'Carolina Hurricanes', 'Calgary Flames', 'Calgary Flames', '2026-10-18');
check('nickname-only NHL event snaps end to end', !!nhl && nhl.winnerImplied === 64 && nhl.otherName === 'Hurricanes');
check('nickname event for a different pair does NOT snap', polymarketSnapFromEvent(MNF, 'Dallas Cowboys', 'Green Bay Packers', 'Dallas Cowboys', '2026-10-19') === null);

console.log(`polymarket-anchor: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
