// Landing root tests (2026-11-06).
//
// parlaykings.net is the club front door: this Worker serves the landing
// page at the root of the parlay hosts, and /api/landing-data feeds it
// from the bets replica. The data rules mirror the member board's: free
// picks show in full, and the locked slate carries league + matchup
// ONLY — no picked winner, no confidence, nothing premium in the
// payload. These tests pin the payload contract, the host gate, and
// the same-host link rewrite the served page depends on (the bell and
// the board only work when the page's app links stay on parlaykings.net,
// where the session lives).

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

// Extract the embedded page and the landing functions.
const htmlMatch = src.match(/const LANDING_HTML = ("(?:\\.|[^"\\])*");/);
check('LANDING_HTML constant embedded', !!htmlMatch);
const EMBEDDED_HTML = htmlMatch ? JSON.parse(htmlMatch[1]) : '';
const names = ['isParlayLandingHost', 'landingHtmlForHost', 'landingEtToday', 'landingLongLabel',
  'landingAddDays', 'landingConfPct', 'landingResultOf', 'buildLandingPayload',
  'todayET', 'boardDateKey', 'boardConfPct', 'boardAnalysisOf', 'boardResultSummaryOf',
  'boardPickFromRecord', 'boardChooseDate', 'boardBandRates', 'boardRankDay',
  'boardVisiblePicks', 'buildLandingBoard'];
const code = names.map(extractFn).join('\n');
eval('var LANDING_HTML = ' + JSON.stringify(EMBEDDED_HTML) + ';\n' + code +
  '\n;global.__x = { isParlayLandingHost, landingHtmlForHost, buildLandingPayload, landingAddDays, buildLandingBoard };');
const X = global.__x;

// --- host gate ---
check('parlaykings.net is a landing host', X.isParlayLandingHost('parlaykings.net') === true);
check('www.parlaykings.net is a landing host', X.isParlayLandingHost('www.parlaykings.net') === true);
check('parlaykings.app is a landing host', X.isParlayLandingHost('parlaykings.app') === true);
check('ai.grimaldi.tv is NOT a landing host', X.isParlayLandingHost('ai.grimaldi.tv') === false);
check('grimaldi.tv is NOT a landing host', X.isParlayLandingHost('grimaldi.tv') === false);
check('empty host is NOT a landing host', X.isParlayLandingHost('') === false);

// --- served page: same-host links, bell, daily stats, royal purple ---
const served = X.landingHtmlForHost();
check('served page carries the bell', served.indexOf('id="bellbtn"') !== -1);
check('served page bell reads real alert endpoints', served.indexOf('/api/alerts/history') !== -1 && served.indexOf('/api/alerts/pending') !== -1);
check('served page has no sample notifications', served.indexOf('sample notifications') === -1);
check('served Sign In stays same-host and returns to the landing page', served.indexOf('href="/login?redirect=%2F"') !== -1);
check('served page navigation has no Todays Board item', served.indexOf('<a href="#picks">Today\'s Board</a>') === -1);
check('served page unlocks the board in place via the gated route', served.indexOf('/api/landing-board') !== -1);
check('served page has no ai.grimaldi.tv login link', served.indexOf('https://ai.grimaldi.tv/login') === -1);
check('served page room links stay same-host via the handoff', served.indexOf('href="/sso/handoff?to=') !== -1);
check('served page shows performance day by day', served.indexOf('day by day') !== -1 && served.indexOf('daily-list') !== -1);
check('served page background is dark royal purple', served.indexOf('--bg:#1d0640') !== -1);

// --- payload contract ---
const today = (() => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
})();
const yday = X.landingAddDays(today, -1);
function rec(date, league, label, pick, conf, result) {
  return { fields: { 'Event Date': date, League: league, 'Bet Label': label, 'Picked Winner': pick, 'Confidence %': conf, Result: result } };
}
const records = [
  rec(today, 'NBA', 'Alpha vs Beta', 'Alpha', 78, 'Pending'),
  rec(today, 'NBA', 'Gamma vs Delta', 'Gamma', 74, 'Pending'),
  rec(today, 'NCAAF', 'Epsilon vs Zeta', 'Epsilon', 71, 'Pending'),
  rec(today, 'TENNIS', 'Eta vs Theta', 'Eta', 69, 'Pending'),
  rec(today, 'NHL', 'Iota vs Kappa', 'Iota', 66, 'Pending'),
  rec(yday, 'NBA', 'Lambda vs Mu', 'Lambda', 80, 'Win'),
  rec(yday, 'NBA', 'Nu vs Xi', 'Nu', 62, 'Loss')
];
const p = X.buildLandingPayload(records);
check('payload ok', p.ok === true);
check('payload board is today with all 5 picks', p.boardDate === today && p.boardCount === 5 && p.todayCount === 5);
check('free picks are the top 3 in full', p.freePicks.length === 3 && p.freePicks[0].pick === 'Alpha' && p.freePicks[0].confidence === 78);
check('locked slate has the other 2 games', p.slate.length === 2 && p.slateTotal === 2);
check('locked slate carries league + matchup ONLY', p.slate.every((s) => Object.keys(s).sort().join(',') === 'league,matchup'));
check('payload slate carries no pick or confidence fields', JSON.stringify(p.slate).indexOf('"pick"') === -1 && JSON.stringify(p.slate).indexOf('confidence') === -1);
check('season counts every record', p.season.total === 7 && p.season.wins === 1 && p.season.losses === 1 && p.season.pending === 5);
check('daily shows yesterday at 50%', p.daily.some((d) => d.date === yday && d.wins === 1 && d.losses === 1 && d.pct === 50));

// empty book: no crash, no invented board
const empty = X.buildLandingPayload([]);
check('empty book payload is ok with an empty board', empty.ok === true && empty.boardCount === 0 && empty.boardDate === '' && empty.freePicks.length === 0);

// --- in-place unlock through the board gate ---
const full = X.buildLandingBoard(records, true);
check('unlock: premium sees every pick in place', full.ok === true && full.date === today && full.picks.length === 5 && full.locked.length === 0);
check('unlock: premium picks carry winner + confidence', full.picks.every((p) => typeof p.pick === 'string' && p.pick.length > 0 && typeof p.confidence === 'number'));
const free = X.buildLandingBoard(records, false);
check('unlock: free member gets the free three plus locked rows', free.picks.length === 3 && free.locked.length === 2);
check('unlock: free locked rows carry league + matchup ONLY', free.locked.every((s) => Object.keys(s).sort().join(',') === 'league,matchup'));
check('unlock: empty book stays empty', X.buildLandingBoard([], true).picks.length === 0);

// --- route wiring present in the handler ---
check('/api/landing-data route is wired', src.indexOf('url.pathname === "/api/landing-data"') !== -1);
check('/api/landing-board route is wired', src.indexOf('url.pathname === "/api/landing-board"') !== -1);
check('root branch serves the landing page on parlay hosts', src.indexOf('isParlayLandingHost(url.hostname)') !== -1 && src.indexOf('landingHtmlForHost()') !== -1);

console.log(`landing-root: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
