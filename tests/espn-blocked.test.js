// ESPN blocking presents as 404: a scoreboard 404 from the Worker's egress
// must trigger the scraper bypass chain like 403/520/429 do, instead of
// silently dropping the league from the slate. Runs under plain node, no
// dependencies. Tests the REAL isEspnBlockedStatus extracted from
// ../src/index.js (never a copy).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
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

eval(extract('isEspnBlockedStatus'));
eval(extract('scoreboardDayStrs'));
eval(extract('fetchScoreboardWindow'));

// Stub network for the window test: one dead day, duplicate games otherwise.
const seenUrls = [];
async function fetchEspnWithRetry(url) {
  seenUrls.push(url);
  if (url.includes('20260918')) return null;
  return { ok: true, json: async () => ({ events: [{ id: '1' }, { id: '2' }] }) };
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

(async function () {
  const SB = 'https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260917';
  eq(isEspnBlockedStatus(403, SB), true, '403 is blocking');
  eq(isEspnBlockedStatus(520, SB), true, '520 is blocking');
  eq(isEspnBlockedStatus(429, SB), true, '429 is blocking');
  eq(isEspnBlockedStatus(404, SB), true, 'scoreboard 404 is blocking (bypass it)');
  eq(isEspnBlockedStatus(404, 'https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/19'), false, 'non-scoreboard 404 is not auto-bypassed');
  eq(isEspnBlockedStatus(200, SB), false, '200 is not blocking');
  eq(isEspnBlockedStatus(500, SB), false, '500 keeps old behavior');
  eq(isEspnBlockedStatus(404, null), false, 'missing url is not blocking');

  // Wiring: the retry helper consults the decision, slate surfaces the status.
  eq(src.includes('isEspnBlockedStatus(res.status, safeUrl)'), true, 'fetch helper consults blocked-status decision');
  eq(src.includes('(HTTP ${res.status})'), true, 'slate error carries the HTTP status');

  // Day windows: ESPN scoreboard takes a single date, so windows fan out.
  const days = scoreboardDayStrs(0, 8, new Date('2026-09-17T12:00:00Z'));
  eq(days.length, 8, 'schedule window covers 8 days');
  eq(days[0], '20260917', 'window starts today');
  eq(days[7], '20260924', 'window ends 7 days out');
  eq(days.every((d) => /^\d{8}$/.test(d)), true, 'every window day is a single date');
  const past = scoreboardDayStrs(-16, 17, new Date('2026-09-17T12:00:00Z'));
  eq(past.length, 17, 'rest window covers 17 days');
  eq(past[16], '20260917', 'rest window ends at anchor');
  const board = await fetchScoreboardWindow('baseball/mlb', ['20260917', '20260918', '20260919'], {});
  eq(seenUrls.length, 3, 'one scoreboard request per day');
  eq(seenUrls.every((u) => /dates=\d{8}$/.test(u)), true, 'every request uses a single date (no ranges)');
  eq(board.okDays, 2, 'a failed day does not fail the window');
  eq(board.events.length, 2, 'duplicate games across days counted once');
  eq(src.includes('dates=${todayStr}-${futureStr}'), false, 'no hyphenated date ranges remain');
  eq(src.includes('dates=${fmt(start)}-${fmt(anchor)}'), false, 'no rest-days range remains');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); process.exit(1); });
