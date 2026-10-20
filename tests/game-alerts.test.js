// Game-day team alerts: prefs, phase detection, transitions, builders, wiring.
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

for (const v of ['var MOVE_CENTS_DEFAULT', 'var MOVE_CENTS_HR_DEFAULT', 'var GAME_TEAM_KEYS', 'var GAME_TEAMS', 'var GAME_ALERT_TYPES']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['gameAlertBypassesQuietHours', 'findTeamEvent', 'gamePhaseOf',
  'nextGameAlerts', 'teamScoreLine', 'gameMatchupLine',
  'buildGameStartAlert', 'buildHalftimeAlert', 'buildFinalAlert',
  'normalizeAlertPrefs', 'sanitizeNotifyPrefs']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}
function eqj(a, b, msg) { eq(JSON.stringify(a), JSON.stringify(b), msg); }

const MICH = { key: 'michigan_fb', label: 'Michigan', teamId: '130', football: true, emoji: 'x' };
const TIGERS = { key: 'tigers', label: 'Tigers', teamId: '6', football: false, emoji: 'x' };

function ev(state, period, extra) {
  const e = {
    id: 'e1', date: '2026-09-19T19:30Z', name: 'UTEP at Michigan',
    status: { clock: 0, displayClock: '0:00', period: period || 0,
      type: Object.assign({ state, completed: state === 'post', detail: state === 'pre' ? 'Sat 3:30 PM EDT' : '' }, (extra && extra.type) || {}) },
    competitions: [{ competitors: [
      { id: '130', homeAway: 'home', score: '14', team: { abbreviation: 'MICH' } },
      { id: '2638', homeAway: 'away', score: '10', team: { abbreviation: 'UTEP' } }
    ] } ]
  };
  return e;
}

(async function () {
  // Config: four teams, ESPN ids verified 2026-09-19.
  eqj(GAME_TEAM_KEYS, ['michigan_fb', 'msu_fb', 'lions', 'tigers'], 'four team keys in fixed order');
  const byId = {};
  for (const t of GAME_TEAMS) byId[t.teamId] = t;
  eq(byId['130'].key, 'michigan_fb', 'Michigan = ESPN 130');
  eq(byId['127'].key, 'msu_fb', 'Michigan State = ESPN 127');
  eq(byId['8'].key, 'lions', 'Lions = ESPN 8');
  eq(byId['6'].key, 'tigers', 'Tigers = ESPN 6');
  eq(byId['130'].espnSport, 'football/college-football', 'Michigan on CFB scoreboard');
  eq(byId['8'].espnSport, 'football/nfl', 'Lions on NFL scoreboard');
  eq(byId['6'].espnSport, 'baseball/mlb', 'Tigers on MLB scoreboard');
  eq(byId['6'].football, false, 'baseball flagged non-football (no halftime)');
  eq(byId['8'].football, true, 'football flagged football');

  // Prefs: teams default OFF (opt-in), game alert types default ON.
  const d = normalizeAlertPrefs(null);
  eqj(d.teams, { michigan_fb: false, msu_fb: false, lions: false, tigers: false }, 'team toggles default off');
  eq(d.alerts.gameStart && d.alerts.halftime && d.alerts.finalScore, true, 'game alert types default on');
  const on = normalizeAlertPrefs({ teams: { michigan_fb: true, lions: true } });
  eq(on.teams.michigan_fb && on.teams.lions, true, 'team opt-ins stick');
  eq(on.teams.msu_fb === false && on.teams.tigers === false, true, 'other teams stay off');
  const junk = normalizeAlertPrefs({ teams: { michigan_fb: 'yes', bogus_team: true } });
  eq(junk.teams.michigan_fb, false, 'non-boolean team pref rejected');
  eq('bogus_team' in junk.teams, false, 'unknown team keys dropped');
  const noHalf = normalizeAlertPrefs({ alerts: { halftime: false } });
  eq(noHalf.alerts.halftime, false, 'halftime type opt-out sticks');
  eq(noHalf.alerts.gameStart && noHalf.alerts.finalScore, true, 'other game types stay on');
  // Server-side sanitize mirrors the same shape (profile POST round-trip).
  const s = sanitizeNotifyPrefs({ teams: { tigers: true }, alerts: { gameStart: false } });
  eq(s.teams.tigers, true, 'sanitize keeps team opt-in');
  eq(s.teams.michigan_fb, false, 'sanitize defaults other teams off');
  eq(s.alerts.gameStart, false, 'sanitize keeps type opt-out');
  eq(sanitizeNotifyPrefs(null).teams.lions, false, 'sanitize null-safe');

  // Quiet-hours bypass: only the three game types skip quiet hours.
  eq(gameAlertBypassesQuietHours('gameStart'), true, 'gameStart bypasses quiet hours');
  eq(gameAlertBypassesQuietHours('halftime'), true, 'halftime bypasses quiet hours');
  eq(gameAlertBypassesQuietHours('finalScore'), true, 'finalScore bypasses quiet hours');
  eq(gameAlertBypassesQuietHours('highEdge'), false, 'highEdge still respects quiet hours');
  eq(gameAlertBypassesQuietHours('recap'), false, 'recap still respects quiet hours');
  eq(gameAlertBypassesQuietHours('lineMoves'), false, 'lineMoves still respects quiet hours');
  eq(gameAlertBypassesQuietHours('bogus'), false, 'unknown type never bypasses');
  eq(gameAlertBypassesQuietHours(null), false, 'null type never bypasses');

  // Phase detection.
  eq(gamePhaseOf(ev('pre', 0), true), 'pre', 'scheduled -> pre');
  eq(gamePhaseOf(ev('in', 1), true), 'first', '1st quarter -> first');
  const q2run = ev('in', 2, { type: { detail: '2nd 5:32' } });
  q2run.status.displayClock = '5:32'; q2run.status.clock = 332;
  eq(gamePhaseOf(q2run, true), 'first', '2nd quarter, clock running -> first');
  eq(gamePhaseOf(ev('in', 2), true), 'half', '2nd quarter, 0:00 -> halftime');
  eq(gamePhaseOf(ev('in', 2, { type: { detail: 'Halftime' } }), true), 'half', 'detail=Halftime -> halftime');
  eq(gamePhaseOf(ev('in', 3), true), 'second', '3rd quarter -> second');
  eq(gamePhaseOf(ev('in', 5), true), 'second', 'overtime -> second, no extra alert');
  eq(gamePhaseOf(ev('post', 4), true), 'post', 'completed -> post');
  const bb2 = ev('in', 2); // baseball: clock is always 0:00
  eq(gamePhaseOf(bb2, false), 'first', 'baseball 2nd inning never halftime');
  eq(gamePhaseOf(ev('in', 7), false), 'first', 'baseball 7th inning stays first phase');
  eq(gamePhaseOf(ev('post', 9), false), 'post', 'baseball final -> post');
  eq(gamePhaseOf({}, true), 'pre', 'garbage event -> pre');
  eq(gamePhaseOf(null, true), 'pre', 'null event -> pre');

  // Transitions: exactly-once semantics, no backfill.
  eqj(nextGameAlerts(null, 'first', true), [], 'first sight bootstraps silently');
  eqj(nextGameAlerts(null, 'post', true), [], 'first sight of a final never backfills');
  eqj(nextGameAlerts('pre', 'pre', true), [], 'no change, no alert');
  eqj(nextGameAlerts('pre', 'first', true), ['gameStart'], 'scheduled->live fires start');
  eqj(nextGameAlerts('pre', 'second', true), ['gameStart'], 'missed first half still announces start');
  eqj(nextGameAlerts('pre', 'half', true), ['gameStart'], 'jump to halftime announces start, not halftime');
  eqj(nextGameAlerts('pre', 'post', true), ['finalScore'], 'missed whole game fires final only');
  eqj(nextGameAlerts('first', 'half', true), ['halftime'], 'end of 2nd quarter fires halftime');
  eqj(nextGameAlerts('first', 'half', false), [], 'baseball never fires halftime');
  eqj(nextGameAlerts('first', 'second', true), [], 'missed halftime window stays silent');
  eqj(nextGameAlerts('first', 'post', true), ['finalScore'], 'live->final fires final');
  eqj(nextGameAlerts('half', 'second', true), [], 'halftime->2nd half is quiet');
  eqj(nextGameAlerts('second', 'post', false), ['finalScore'], 'baseball final fires final');
  eqj(nextGameAlerts('half', 'first', true), [], 'clock correction never refires');
  eqj(nextGameAlerts('post', 'pre', true), [], 'phase rewind after final is quiet (new game = new eventId)');

  // Event picking: live beats upcoming beats recent.
  const pre1 = ev('pre', 0); pre1.id = 'p1'; pre1.date = '2026-09-19T19:30Z';
  const pre2 = ev('pre', 0); pre2.id = 'p2'; pre2.date = '2026-09-26T19:30Z';
  const live = ev('in', 3); live.id = 'lv';
  const post = ev('post', 4); post.id = 'po';
  eq(findTeamEvent([pre1, pre2], '130').id, 'p1', 'soonest upcoming wins');
  eq(findTeamEvent([pre1, live, pre2], '130').id, 'lv', 'live beats upcoming');
  eq(findTeamEvent([post], '130').id, 'po', 'recent post returned when nothing else');
  eq(findTeamEvent([pre1], '999'), null, 'other teams ignored');
  eq(findTeamEvent([], '130'), null, 'empty board -> null');
  eq(findTeamEvent(null, '130'), null, 'null board -> null');

  // Score lines: our team first, defensive fallbacks.
  eq(teamScoreLine(ev('in', 3), MICH), 'MICH 14, UTEP 10', 'our team leads the line');
  const away = ev('in', 3);
  away.competitions[0].competitors.reverse();
  eq(teamScoreLine(away, MICH), 'MICH 14, UTEP 10', 'order independent of home/away listing');
  const noname = ev('in', 3);
  delete noname.competitions[0].competitors[0].team;
  delete noname.competitions[0].competitors[1].team;
  eq(teamScoreLine(noname, MICH), 'Michigan 14, Opponent 10', 'missing names degrade to labels');
  eq(teamScoreLine(null, MICH), 'Michigan', 'null event degrades to label');
  eq(gameMatchupLine(ev('pre', 0), MICH), 'UTEP at Michigan', 'matchup line from event name');

  // Builders: right types, branded titles.
  const gs = buildGameStartAlert(MICH, ev('pre', 0));
  eq(gs.type, 'gameStart', 'start alert type');
  eq(gs.title.indexOf('Michigan') >= 0 && gs.title.indexOf('underway') >= 0, true, 'start title names the team');
  const ht = buildHalftimeAlert(MICH, ev('in', 2));
  eq(ht.type, 'halftime', 'halftime alert type');
  eq(ht.title.indexOf('Halftime') >= 0 && ht.title.indexOf('MICH 14, UTEP 10') >= 0, true, 'halftime title carries score');
  const fs = buildFinalAlert(TIGERS, ev('post', 9));
  eq(fs.type, 'finalScore', 'final alert type');
  eq(fs.title.indexOf('Final') >= 0 && fs.title.indexOf('Tigers') >= 0, true, 'final title names the team');
  for (const a of [gs, ht, fs]) {
    eq(typeof a.body === 'string' && a.body.indexOf('ParlayKings') >= 0, true, 'alert body branded ParlayKings');
    eq(a.url, '/', 'alert links home');
  }

  // Wiring: dispatcher bypasses quiet hours for game types; cron pass runs the checker.
  const disp = src.slice(src.indexOf('async function dispatchAlert'));
  eq(disp.indexOf('gameAlertBypassesQuietHours(alert.type)') >= 0, true, 'dispatchAlert consults the quiet-hours bypass');
  const rap = src.slice(src.indexOf('async function runAlertPass'));
  eq(rap.indexOf('runGameAlertChecks(env, kv)') >= 0, true, 'runAlertPass runs game checks');
  eq(src.indexOf('async function runGameAlertChecks') >= 0, true, 'runGameAlertChecks defined');
  eq(src.indexOf("notify:") >= 0 && src.indexOf('data-team') >= 0, true, 'profile UI carries team toggles');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
