// v1 notification dispatcher: prefs, quiet hours, interests, builders, wiring.
//
// Tests the REAL bundle functions by extracting them from ../src/index.js
// (never a copy). Runs under plain node, no dependencies.
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

for (const v of ['var MOVE_CENTS_DEFAULT', 'var MOVE_CENTS_HR_DEFAULT', 'var GAME_TEAM_KEYS']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['normalizeAlertPrefs', 'etParts', 'inQuietHoursET',
  'collectInterests', 'interestMatches', 'fmtLinePrice',
  'buildHighEdgeAlert', 'groupRecapByLeague', 'buildRecapAlert',
  'fetchGradedRecords',
  'movementDirection', 'buildLineMoveAlert', 'buildBundleEntry', 'alertLandingUrl',
  'shortTeamName', 'americanToImplied', 'parseAmericanPrice', 'parseOpeningLineFromText']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

(async function () {
  // Prefs: safe defaults, never crash on garbage, per-user tunables clamped.
  const d = normalizeAlertPrefs(null);
  eq(d.enabled, false, 'prefs default to disabled (no push without opt-in)');
  eq(d.alerts.highEdge && d.alerts.recap && d.alerts.lineMoves, true, 'alert types default on');
  eq(d.moveCents, 25, 'default overall move threshold 25c');
  eq(d.moveCentsHr, 15, 'default hourly move threshold 15c');
  eq(normalizeAlertPrefs({ moveCents: 500 }).moveCents, 200, 'move threshold capped');
  eq(normalizeAlertPrefs({ moveCents: 1 }).moveCents, 5, 'move threshold floored');
  eq(normalizeAlertPrefs({ moveCentsHr: 'fast' }).moveCentsHr, 15, 'non-numeric hourly defaulted');
  eq(normalizeAlertPrefs({ alerts: { recap: false } }).alerts.recap, false, 'alert type opt-out sticks');
  eq(normalizeAlertPrefs({ alerts: { recap: false } }).alerts.highEdge, true, 'other types stay on');
  eq(normalizeAlertPrefs({ minConfidence: 30 }).minConfidence, 50, 'legacy threshold clamp intact');
  eq(normalizeAlertPrefs(null).alerts.announcement, true, 'announcement type defaults on');
  eq(normalizeAlertPrefs({ alerts: { announcement: false } }).alerts.announcement, false, 'announcement opt-out sticks');
  eq(normalizeAlertPrefs({ alerts: { announcement: false } }).alerts.recap, true, 'announcement opt-out leaves other types on');

  // Quiet hours: ET, overnight wrap, unset means always send.
  const T = (y, mo, dd, h, mi) => Date.UTC(y, mo, dd, h, mi);
  eq(inQuietHoursET({ start: '22:00', end: '07:00' }, T(2026, 0, 15, 4, 0)), true, 'overnight quiet at 23:00 ET');
  eq(inQuietHoursET({ start: '22:00', end: '07:00' }, T(2026, 0, 15, 17, 0)), false, 'midday not quiet');
  eq(inQuietHoursET({ start: '09:00', end: '17:00' }, T(2026, 0, 15, 14, 0)), true, 'daytime quiet at 09:00 ET');
  eq(inQuietHoursET({ start: '09:00', end: '17:00' }, T(2026, 0, 15, 22, 0)), false, 'daytime quiet over at 17:00 ET');
  eq(inQuietHoursET({ start: null, end: null }, T(2026, 0, 15, 4, 0)), false, 'unset quiet hours never block');
  eq(inQuietHoursET({ start: '25:99', end: 'x' }, T(2026, 0, 15, 4, 0)), false, 'bad quiet times never block');

  // Interests: league prefs plus pins; empty prefs mean open to all leagues.
  const open = collectInterests({ notify: { enabled: true }, pins: { chats: {}, picks: {} } });
  eq(open.leagueOpen, true, 'no league prefs means open to all');
  const scoped = collectInterests({
    notify: { enabled: true, leagues: { MLB: true, NFL: false } },
    pins: { chats: { c1: { title: 'Padres vs Rockies' } }, picks: { 'c2:9': { matchup: 'Lakers vs Celtics', league: 'NBA' } } }
  });
  eq(scoped.leagueOpen, false, 'any league pref closes open mode');
  eq(interestMatches(scoped, 'MLB', 'Yankees vs Red Sox').leagueOk, true, 'league pref matches');
  eq(interestMatches(scoped, 'NHL', 'Rangers vs Devils').leagueOk, false, 'other league excluded');
  eq(interestMatches(scoped, 'NHL', 'Rangers vs Devils').pinned, false, 'unpinned matchup not pinned');
  eq(interestMatches(scoped, 'WNBA', 'Padres vs Rockies').pinned, true, 'pinned chat title matches by text');
  eq(interestMatches(scoped, 'NBA', 'Lakers vs Celtics').pinned, true, 'pinned pick matches by matchup');
  eq(interestMatches(collectInterests(null), 'MLB', 'A vs B').leagueOk, true, 'missing profile degrades to open');

  // Builders: rich, organized, market-intel framing (never bet tracking).
  const he = buildHighEdgeAlert(
    { matchup: 'Padres vs Rockies', winner: 'San Diego Padres', confidence: 78, league: 'MLB' },
    { winnerPrice: -167, bookmakerTitle: 'DraftKings' });
  eq(he.type, 'highEdge', 'high-edge type set');
  eq(he.title, 'ParlayKings 78% — San Diego Padres', 'high-edge title is brand-first with pick up front');
  eq(he.title.includes('SAM'), false, 'high-edge title never uses the internal SAM name');
  eq(he.body, 'Padres vs Rockies · Predicted winner: San Diego Padres -167 (DraftKings)', 'high-edge body names the predicted winner in full');
  eq(he.short.includes('San Diego Padres') && he.short.includes('78%'), true, 'high-edge carries a compact bundle line');
  const heNoLine = buildHighEdgeAlert({ matchup: 'A vs B', winner: 'A', confidence: 60, league: 'X' }, null);
  eq(heNoLine.body, 'A vs B · Predicted winner: A', 'missing line still names the predicted winner');
  eq(heNoLine.body.includes('unavailable'), false, 'missing line never prints unavailable in place of the winner');
  eq(heNoLine.short.includes('unavailable'), false, 'bundle line never prints unavailable either');

  const groups = groupRecapByLeague(
    [{ league: 'MLB', result: 'Win' }, { league: 'MLB', result: 'Loss' }, { league: 'NFL', result: 'Win' }, { league: '', result: 'Win' }],
    { leagues: new Set(['mlb']), leagueOpen: false, pins: [] });
  eq(groups.length, 1, 'recap scoped to leagues of interest');
  eq(groups[0].w === 1 && groups[0].l === 1, true, 'recap counts wins and losses');
  const rc = buildRecapAlert('last night', groups);
  eq(rc.title.includes('1-1') && rc.body.includes('MLB: 1-1'), true, 'recap alert formats organized lines');
  eq(buildRecapAlert('last night', []), null, 'empty recap skipped (no pointless push)');

  eq(movementDirection(-167, -195), 'toward', 'shortening price is toward the pick');
  eq(movementDirection(-167, -140), 'against', 'drifting price is against the pick');
  eq(movementDirection(-110, -110), 'steady', 'flat line is steady');
  const mv = buildLineMoveAlert(
    { matchup: 'Padres vs Rockies', winner: 'San Diego Padres', confidence: 72, league: 'MLB' }, -167, -195, -28, 'toward');
  eq(mv.type, 'lineMoves', 'movement type set');
  eq(mv.title, 'Steam toward ParlayKings: Padres', 'movement title uses ParlayKings, not SAM');
  eq(mv.title.includes('SAM'), false, 'movement title never uses the internal SAM name');
  eq(mv.title.includes('Steam'), true, 'toward move framed as steam');
  eq(mv.body.includes('-167') && mv.body.includes('-195') && mv.body.includes('28'), true, 'movement body shows logged, current, cents');
  eq(mv.body.includes('your bet') || mv.body.includes('Your bet'), false, 'movement never framed as bet tracking');
  const mvAgainst = buildLineMoveAlert(
    { matchup: 'Padres vs Rockies', winner: 'San Diego Padres', confidence: 72, league: 'MLB' }, -167, -130, 37, 'against');
  eq(mvAgainst.body.includes('re-run'), true, 'against move suggests a re-run');

  // Bundling: pick alerts landing close together collapse into one notification.
  const b1 = buildBundleEntry(
    [{ id: 'a', type: 'highEdge', title: 'ParlayKings 78% — X', body: 'b', short: 'X (78%) — M · L', url: '/', at: 1 }], 1000);
  eq(b1.title, 'ParlayKings 78% — X', 'single-item bundle passes the alert through untouched');
  eq(b1.body, 'b', 'single-item bundle keeps the original body');
  const b3 = buildBundleEntry([
    { id: 'a', type: 'highEdge', title: 't1', body: 'b1', short: 's1', url: '/', at: 1 },
    { id: 'b', type: 'lineMoves', title: 't2', body: 'b2', short: 's2', url: '/', at: 2 },
    { id: 'c', type: 'highEdge', title: 't3', body: 'b3', short: 's3', url: '/', at: 3 },
  ], 1000);
  eq(b3.title, 'ParlayKings: 3 new picks', 'multi-item bundle gets a combined title');
  eq(b3.body, 's1\ns2\ns3', 'bundle body lists one compact line per pick');
  eq(b3.url, '/?alert=' + encodeURIComponent(b3.id), 'bundle tap lands on the full-message screen');
  const many = [];
  for (let i = 1; i <= 10; i++) many.push({ id: 'm' + i, type: 'highEdge', title: 't' + i, body: 'b' + i, short: 's' + i, url: '/', at: i });
  const b10 = buildBundleEntry(many, 2000);
  eq(b10.body.split('\n').length, 10, 'bundle body carries every pick, no cut-off');
  eq(b10.body.includes('more'), false, 'bundle body has no "+N more" tail');
  eq(alertLandingUrl('he:rec1:user-x'), '/?alert=he%3Arec1%3Auser-x', 'landing URL encodes the alert id');

  // Wiring: single choke point, routes, cron, log hook, sw pull, columns.
  eq(src.includes('async function dispatchAlert(env, ns, alert)'), true, 'dispatcher is the single send choke point');
  eq(src.includes('sendPushTicket(env, sub)') && src.includes('await dispatchAlert(env, u.ns'), true, 'all alert pushes flow through the dispatcher');
  eq(src.includes('url.pathname === "/api/alerts/pending"'), true, 'pending-alerts route present');
  eq(src.includes('url.pathname === "/api/alerts/ack"'), true, 'alert-ack route present');
  eq(src.includes('url.pathname === "/api/alerts/history"'), true, 'alert-history route present (landing screen data)');
  eq(src.includes('await appendAlertHistory(kv, ns, entry);'), true, 'dispatcher records every alert in history');
  eq(src.includes('function openAlertView(id)'), true, 'frontend landing screen for notification taps present');
  eq(src.includes('entry.url = alert.url && String(alert.url) !== "/"'), true, 'alerts without their own destination tap through to the landing screen');
  eq(src.includes('url.pathname === "/admin/send-announcement"'), true, 'admin send-announcement route present');
  eq(src.includes('async function fanoutAnnouncement(env, title, body, targetUrl)'), true, 'announcement fan-out function present');
  eq(src.includes('type: "announcement"'), true, 'fan-out sends the announcement alert type');
  eq(src.includes('pf-aAnnounce'), true, 'profile modal exposes the announcement toggle');
  eq(src.includes('await runAlertPass(env);'), true, 'cron runs the alert pass');
  eq(src.includes('ctx.waitUntil(fanoutHighEdgeAlert('), true, 'board runs fan high-edge alerts out off the hot path');
  eq(src.includes('await dispatchHighEdgeAlert(env,'), true, 'single predictions still alert their owner');
  eq(src.includes('return { logged: true, recordId: _recordId };'), true, 'log path reports fresh writes for alerting');
  eq(src.includes('fetch(\'/api/alerts/pending\''), true, 'service worker pulls rich alert content');
  eq(src.includes("(nowMs - (jobs[i].doneAt || 0)) < 15 * 60 * 1000"), true, 'stale jobs are not re-announced by alert tickets');
  eq(src.includes('var alertsOnly'), false, 'generic fallback banner removed (no job, no alerts, no banner)');
  eq(src.includes('Logged Line') && src.includes('Line Movement'), true, 'dedicated Airtable line columns used');
  eq(src.includes('UNKNOWN_FIELD'), true, 'missing line columns degrade without breaking logging');
  eq(src.includes('pf-aHighEdge') && src.includes('pf-moveCents'), true, 'profile modal exposes alert tunables');
  eq(src.includes('ALERT_BUNDLE_TYPES[alert.type]'), true, 'dispatcher routes pick alerts into the bundle');
  eq(src.includes('await flushAlertBundles(env, kv);'), true, 'minutely alert pass flushes bundles');
  eq(src.includes('var ALERT_BUNDLE_WINDOW_MS = 5 * 60 * 1000'), true, 'bundle window is five minutes');
  eq(src.includes('var ALERT_BUNDLE_TYPES = { lineMoves: true };'), true, 'pick alerts no longer bundle; line moves still do');
  eq(src.includes('alert.type === "highEdge"'), true, 'dispatcher holds pick alerts at dispatch');
  eq(src.includes('runPickHoldRelease'), true, 'alert pass releases held picks');
  eq(src.includes('if (hour < 10) return;'), true, 'pick releases start at 10 AM ET');
  eq(src.includes('var PICK_HOLD_BATCH = 12;'), true, 'pick releases batch twelve at a time');
  eq(src.includes('pkJumpToAlertGame'), true, 'notification tap jumps to the game write-up');

  // Recap double-count: two provider targets resolving to the same base count once.
  globalThis.airtableProviderTargets = () => [{ baseId: 'same' }, { baseId: 'same' }];
  globalThis.airtableBetsTableId = () => 'tblBets';
  const gradedRows = [];
  for (let i = 0; i < 7; i++) gradedRows.push({ id: 'recW' + i, fields: { League: 'MLB', Result: 'Win' } });
  for (let i = 0; i < 2; i++) gradedRows.push({ id: 'recL' + i, fields: { League: 'MLB', Result: 'Loss' } });
  let gradedFetches = 0;
  globalThis.fetch = async () => { gradedFetches++; return { ok: true, json: async () => ({ records: gradedRows }) }; };
  const dup = await fetchGradedRecords({ AIRTABLE_API_KEY: 'k' }, '2026-09-16');
  eq(gradedFetches, 2, 'one page fetched per provider target');
  eq(dup.length, 9, 'same base twice still yields 9 graded records');
  const dupGroups = groupRecapByLeague(dup, { leagues: new Set(), leagueOpen: true, pins: [] });
  eq(dupGroups.length, 1, 'one league group');
  eq(dupGroups[0].w, 7, 'wins counted once (7, not 14)');
  eq(dupGroups[0].l, 2, 'losses counted once (2, not 4)');
  globalThis.airtableProviderTargets = () => [{ baseId: 'same' }];
  const single = await fetchGradedRecords({ AIRTABLE_API_KEY: 'k' }, '2026-09-16');
  eq(JSON.stringify(single), JSON.stringify(dup), 'two targets match a single target exactly');
  delete globalThis.fetch; delete globalThis.airtableProviderTargets; delete globalThis.airtableBetsTableId;
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); process.exit(1); });
