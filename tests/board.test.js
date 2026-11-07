// Board tests (2026-11-05, Phase 3).
//
// Drew's hard requirement for /board: Premium access to the full board
// is enforced SERVER-SIDE. A free member's response is built from
// boardVisiblePicks() output only, and for locked games that output is
// { league, matchup } — the premium pick, confidence, and analysis
// must not exist anywhere in what a free browser receives. These tests
// pin that gate, the free-3 selection (same confidence-band ranking
// the landing page states publicly), and the empty-board fallback.

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
    if (c === '/' && n === '/') { lineComment = true; continue; }
    if (c === '/' && n === '*') { blockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function ' + name);
}

for (const fn of ['boardConfPct', 'boardResultSummaryOf', 'boardAnalysisOf', 'boardPickFromRecord',
  'boardDateKey', 'boardChooseDate', 'boardBandRates', 'boardRankDay', 'boardVisiblePicks',
  'boardSeasonRecord', 'boardRoomForLeague', 'boardRoomHref', 'boardFilterByLeague']) {
  eval(extractFn(fn));
}
// boardRenderHtml + samNetworkNavHtml/Css are exercised as source-level
// checks below (they need the full page environment to run).

const rec = (date, league, label, winner, conf, result, notes) => ({
  fields: {
    'Event Date': date, 'League': league, 'Bet Label': label, 'Picked Winner': winner,
    'Confidence %': conf, 'Result': result, 'Notes': notes || ''
  }
});

// --- confidence normalization ---
check('fraction confidence -> pct', boardConfPct(0.77) === 77);
check('percent confidence stays', boardConfPct(77) === 77);
check('missing confidence -> null', boardConfPct('') === null && boardConfPct(0) === null);

// --- band fixtures: 70s band hot (24 decided, 75%), 80s cold ---
const hist = [];
for (let i = 0; i < 18; i++) hist.push(rec('2026-10-20', 'NBA', 'H' + i, 'Home', 0.75, 'Win'));
for (let i = 0; i < 6; i++) hist.push(rec('2026-10-20', 'NBA', 'H' + i, 'Home', 0.75, 'Loss'));
for (let i = 0; i < 15; i++) hist.push(rec('2026-10-20', 'NBA', 'H' + i, 'Home', 0.85, 'Loss'));
for (let i = 0; i < 10; i++) hist.push(rec('2026-10-20', 'NBA', 'H' + i, 'Home', 0.85, 'Win'));
const rates = boardBandRates(hist, '2026-11-05');
check('band 70 rate computed', Math.abs(rates.bands.get(70).w / 24 - 0.75) < 1e-9);

// --- THE access gate ---
const day = [
  { league: 'NBA', matchup: 'A vs B', pick: 'Alpha', confidence: 77, result: 'Pending', analysis: 'SECRET ANALYSIS ALPHA', resultSummary: '' },
  { league: 'NBA', matchup: 'C vs D', pick: 'Charlie', confidence: 76, result: 'Pending', analysis: 'SECRET ANALYSIS CHARLIE', resultSummary: '' },
  { league: 'NHL', matchup: 'E vs F', pick: 'Echo', confidence: 75, result: 'Pending', analysis: 'SECRET ANALYSIS ECHO', resultSummary: '' },
  { league: 'NFL', matchup: 'G vs H', pick: 'GolfPremium', confidence: 85, result: 'Pending', analysis: 'SECRET ANALYSIS GOLF', resultSummary: '' },
  { league: 'NFL', matchup: 'I vs J', pick: 'IndiaPremium', confidence: 84, result: 'Pending', analysis: 'SECRET ANALYSIS INDIA', resultSummary: '' }
];
const free = boardVisiblePicks(day, false, rates);
check('free sees exactly 3 visible', free.visible.length === 3);
check('free locked count = rest', free.locked.length === 2);
check('free-3 are the hot-band picks, not the raw-confidence leaders',
  free.visible.map((p) => p.pick).join(',') === 'Alpha,Charlie,Echo');
check('locked entries carry ONLY league + matchup',
  free.locked.every((l) => Object.keys(l).sort().join(',') === 'league,matchup'));
const freeJson = JSON.stringify(free);
check('no premium pick name anywhere in free payload', !freeJson.includes('GolfPremium') && !freeJson.includes('IndiaPremium'));
check('no premium confidence anywhere in free payload', !freeJson.includes('85') && !freeJson.includes('84'));
check('no premium analysis anywhere in free payload', !freeJson.includes('SECRET ANALYSIS GOLF') && !freeJson.includes('SECRET ANALYSIS INDIA'));
const prem = boardVisiblePicks(day, true, rates);
check('premium sees all 5, none locked', prem.visible.length === 5 && prem.locked.length === 0);
check('premium payload includes analysis', JSON.stringify(prem).includes('SECRET ANALYSIS GOLF'));

// --- empty-board date choice ---
check('today present -> today', boardChooseDate(['2026-11-05', '2026-11-04'], '2026-11-05') === '2026-11-05');
check('today empty -> most recent earlier board', boardChooseDate(['2026-11-04', '2026-11-02'], '2026-11-05') === '2026-11-04');
check('no dates -> empty', boardChooseDate([], '2026-11-05') === '');
check('only future dates -> empty', boardChooseDate(['2026-11-07'], '2026-11-05') === '');

// --- record + record shaping ---
const season = boardSeasonRecord([...hist, rec('2026-11-04', 'NBA', 'X vs Y', 'X', 0.6, 'Push'), rec('2026-11-04', 'NBA', 'Z vs W', 'Z', 0.6, 'Pending')]);
check('season record counts', season.wins === 28 && season.losses === 21 && season.pushes === 1 && season.pending === 1 && season.decided === 49);
const shaped = boardPickFromRecord(rec('2026-11-04', 'NBA', 'Lakers vs Celtics', 'Lakers', 0.77, 'Win',
  'SAM pick [X]\nAnalysis only - not betting advice.\nFull reply: Lakers control the glass. · Result: Won 110-102.'));
check('record shaping: winner/conf/result', shaped.pick === 'Lakers' && shaped.confidence === 77 && shaped.result === 'Win');
check('analysis extracted, markers stripped', shaped.analysis.includes('Lakers control the glass') && !shaped.analysis.includes('SHADOWGUARD'));
check('result summary extracted', shaped.resultSummary.includes('Won 110-102'));
const shaped2 = boardPickFromRecord(rec('2026-11-04', 'NCAAF', 'Ball State Cardinals vs Massachusetts Minutemen', 'Massachusetts Minutemen', 0.77, 'Win',
  'Auto-logged from ai.grimaldi.tv (SAM 1.7.2) · Q: Ball State Cardinals vs Massachusetts Minutemen NCAAF · Auto-graded 2026-11-04: Massachusetts Minutemen: 31 - Ball State Cardinals: 30\n\n---FULLREPLY---\nWednesday night in Amherst sends Ball State into Warren McGuirk Alumni Stadium. · Result: Final: Massachusetts Minutemen 31, Ball State Cardinals 30. Pick: Massachusetts Minutemen (77%) — Win.'));
check('FULLREPLY shape: analysis is the write-up, not the grader header',
  shaped2.analysis.startsWith('Wednesday night in Amherst') && !shaped2.analysis.includes('Auto-graded') && !shaped2.analysis.includes('FULLREPLY'));
check('FULLREPLY shape: summary is the clean graded tail',
  shaped2.resultSummary.startsWith('Final: Massachusetts Minutemen 31') && !shaped2.resultSummary.includes('Wednesday night'));

// --- sports rooms + league views (Phase 7) ---
check('room map: NFL -> Football', boardRoomForLeague('NFL').url.includes('football.grimaldi.tv'));
check('room map: NCAAF -> Football', boardRoomForLeague('NCAAF').name === 'Football');
check('room map: NBA/NCAAB -> Basketball', boardRoomForLeague('NBA').name === 'Basketball' && boardRoomForLeague('NCAAB').name === 'Basketball');
check('room map: WTA -> Tennis', boardRoomForLeague('WTA').url.includes('tennis.grimaldi.tv'));
check('room map: unknown league -> no room', boardRoomForLeague('Soccer') === null);
check('room href goes through the SSO handoff', boardRoomHref('NHL').startsWith('/sso/handoff?to='));
// The filter runs AFTER the gate: a free member filtering by a league
// outside their free three still sees zero full picks from that league.
const gatedFree = boardVisiblePicks(day, false, rates);
const nbaOnly = boardFilterByLeague(gatedFree.visible, gatedFree.locked, 'NBA');
check('filter narrows visible+locked by league', nbaOnly.visible.every(p => p.league === 'NBA') && nbaOnly.locked.every(p => p.league === 'NBA'));
check('filter never expands free access', nbaOnly.visible.length <= gatedFree.visible.length && nbaOnly.visible.every(p => gatedFree.visible.includes(p)));
check('filter is case-insensitive and trims', boardFilterByLeague(gatedFree.visible, gatedFree.locked, ' nba ').visible.length === nbaOnly.visible.length);
check('empty filter returns the gated lists unchanged', boardFilterByLeague(gatedFree.visible, gatedFree.locked, '').visible === gatedFree.visible);
check('handler filters AFTER the gate', src.indexOf('boardFilterByLeague(gated.visible') > src.indexOf('boardVisiblePicks(dayPicks'));
check('rendered cards link back to their room', src.includes('roomlink') && src.includes('boardRoomHref(p.league)'));

// --- route + wiring (source level) ---
check('/board route registered', src.includes('url.pathname === "/board"'));
check('board handler requires session', /handleBoardPage[\s\S]{0,400}if \(!session\)/.test(src));
check('board handler gates on hasSportsSiteAccess', /handleBoardPage[\s\S]{0,600}hasSportsSiteAccess\(bettor\)/.test(src));
check('board handler reads the replica', /handleBoardPage[\s\S]{0,900}loadBetsReplica\(env\)/.test(src));
check('member default: redirect excludes slate admin', src.includes('!isSlateAdmin(session) && rootIsParlay'));
check('member default: Stripe returns never redirect', src.includes('!url.searchParams.has("purchase")'));
check('no per-prediction Ask SAM links anywhere (removed at Drew\'s order)', !src.includes('Ask SAM about this game') && !src.includes('boardAskHref') && !src.includes("params.get('ask')"));
const navShared = src.slice(src.indexOf('function samNetworkNavHtml'), src.indexOf('__name(samNetworkNavHtml'));
check('shared nav: no Todays Board item (retired with /board)', navShared.indexOf("Today's Board") === -1 && !navShared.includes('href="/board"'));
const chatNav = src.slice(src.indexOf('const chatPodcastLinks'), src.indexOf('${sportsbookDrawerHtml()}'));
check('chat nav: no Todays Board item (retired with /board)', !chatNav.includes('href="/board">Today\'s Board</a>'));

console.log(`board tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
