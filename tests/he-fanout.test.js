// High-edge fan-out + drip queue: admin "run all" alerts every subscribed user
// per their prefs; future-game alerts scatter through the day (one per
// DRIP_MIN_MS per user), same-day games go immediately.
//
// Tests the REAL bundle functions by extracting them from ../src/index.js
// (never a copy). I/O boundaries (replicaKv, loadAlertUsers,
// parseOpeningLineFromText, buildHighEdgeAlert, dispatchAlert) are stubbed;
// the fan-out loop, per-user dedupe keys, drip enqueue/release, spacing, and
// skip handling are the real code. Runs under plain node, no dependencies.
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

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

function memKv() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list(o) {
      const keys = [];
      for (const k of m.keys()) if (!o || !o.prefix || k.startsWith(o.prefix)) keys.push({ name: k });
      return { keys };
    },
    _map: m,
  };
}

// ---- stubs for I/O boundaries (real code closes over these) ----
let USERS = [];
let dispatchBehavior = 'push'; // 'push' | 'rate-cap' | 'duplicate'
const dispatched = [];
function replicaKv(env) { return env && env.__kv ? env.__kv : null; }
async function loadAlertUsers(env, kv) { return USERS; }
function parseOpeningLineFromText(t) { return null; }
function buildHighEdgeAlert(pick, line) {
  return { type: 'highEdge', league: pick.league, matchup: pick.matchup,
           confidence: pick.confidence, title: 't', body: 'b', url: '/' };
}
async function dispatchAlert(env, ns, alert) {
  dispatched.push({ ns, dedupeKey: alert.dedupeKey, type: alert.type });
  if (dispatchBehavior === 'push') {
    try { await env.__kv.put('alertseen:' + alert.dedupeKey, '1'); } catch (e) {}
    return { pushed: true, queued: true, skipped: null };
  }
  if (dispatchBehavior === 'rate-cap') return { pushed: false, queued: false, skipped: 'rate-cap' };
  return { pushed: false, queued: false, skipped: 'duplicate' };
}

// ---- real code under test ----
for (const v of ['var DRIP_MIN_MS', 'var DRIP_PREFIX', 'var DRIP_CAP']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['etParts', 'inQuietHoursET', 'highEdgeDedupeKey',
  'loadDripQueue', 'saveDripQueue', 'dripEnqueue',
  'fanoutHighEdgeAlert', 'runDripQueue']) {
  eval(extract(fn));
}

const NOPREFS = { quietHours: { start: null, end: null } };

(async () => {
  eq(highEdgeDedupeKey('rec123', 'Grimillionaire'), 'he:rec123:Grimillionaire', 'dedupe key is per-user');
  eq(highEdgeDedupeKey('rec123', 'anna') === highEdgeDedupeKey('rec123', 'bob'), false, 'different users get different keys');

  const today = etParts(Date.now()).date;
  const mkPick = (eventDate) => ({ league: 'MLB', matchup: 'Cubs vs Reds', winner: 'Chicago Cubs', confidence: 78, eventDate });

  // --- same-day game: immediate fan-out ---
  USERS = [{ ns: 'anna', prefs: NOPREFS }, { ns: 'bob', prefs: NOPREFS }];
  dispatched.length = 0;
  let env = { __kv: memKv() };
  let out = await fanoutHighEdgeAlert(env, mkPick(today), 'rec123', 'reply');
  eq(out.users, 2, 'fanout sees both users');
  eq(out.fanned, 1 + 1, 'same-day game pushes to everyone passing');
  eq(dispatched.length, 2, 'dispatch attempted for every user');
  eq(dispatched[0].dedupeKey, 'he:rec123:anna', 'anna dedupe key carries her ns');

  // --- missing eventDate: immediate (safer default) ---
  dispatched.length = 0;
  env = { __kv: memKv() };
  out = await fanoutHighEdgeAlert(env, mkPick(undefined), 'rec124', 'reply');
  eq(out.fanned, 2, 'unknown date sends immediately');

  // --- future game: dripped, not dispatched ---
  dispatched.length = 0;
  env = { __kv: memKv() };
  out = await fanoutHighEdgeAlert(env, mkPick('2099-04-01'), 'rec125', 'reply');
  eq(out.dripped, 2, 'future game drips for both users');
  eq(dispatched.length, 0, 'future game dispatches nothing immediately');
  const q = await loadDripQueue(env.__kv, 'anna');
  eq(q.length, 1, 'one drip queued for anna');
  eq(q[0].alert.dedupeKey, 'he:rec125:anna', 'queued alert carries per-user dedupe key');

  // --- drip enqueue dedupes within the queue ---
  const again = await dripEnqueue(env, env.__kv, 'anna', q[0].alert);
  eq(again, true, 're-enqueue reports ok');
  eq((await loadDripQueue(env.__kv, 'anna')).length, 1, 'no double queue for same pick+user');

  // --- already-delivered pick is not re-queued ---
  await env.__kv.put('alertseen:he:rec999:bob', '1');
  const qlenBefore = (await loadDripQueue(env.__kv, 'bob')).length;
  await dripEnqueue(env, env.__kv, 'bob', { type: 'highEdge', dedupeKey: 'he:rec999:bob' });
  eq((await loadDripQueue(env.__kv, 'bob')).length, qlenBefore, 'delivered pick not re-queued');

  // --- release: old drip clock -> head released ---
  dispatchBehavior = 'push';
  dispatched.length = 0;
  await env.__kv.put('driplast:anna', String(Date.now() - DRIP_MIN_MS - 1000));
  await runDripQueue(env, env.__kv);
  eq(dispatched.length, 2, 'due drips release independently per user');
  eq(dispatched.some((d) => d.ns === 'anna') && dispatched.some((d) => d.ns === 'bob'), true, 'both queue owners released');
  eq((await loadDripQueue(env.__kv, 'anna')).length, 0, 'released head leaves the queue');
  const last = Number(await env.__kv.get('driplast:anna'));
  eq(Math.abs(Date.now() - last) < 60000, true, 'drip clock advances on release');

  // --- release: recent drip clock -> spacing holds ---
  await dripEnqueue(env, env.__kv, 'anna', { type: 'highEdge', dedupeKey: 'he:rec126:anna' });
  dispatched.length = 0;
  await runDripQueue(env, env.__kv);
  eq(dispatched.length, 0, 'spacing suppresses back-to-back drips');
  eq((await loadDripQueue(env.__kv, 'anna')).length, 1, 'suppressed drip stays queued');

  // --- release: transient skip (rate-cap) keeps head, clock untouched ---
  dispatchBehavior = 'rate-cap';
  await env.__kv.put('driplast:anna', String(Date.now() - DRIP_MIN_MS - 1000));
  const clockBefore = await env.__kv.get('driplast:anna');
  await runDripQueue(env, env.__kv);
  eq((await loadDripQueue(env.__kv, 'anna')).length, 1, 'rate-capped drip stays at head');
  eq(await env.__kv.get('driplast:anna'), clockBefore, 'clock untouched on transient skip');

  // --- release: permanent skip (duplicate) drops head ---
  dispatchBehavior = 'duplicate';
  await runDripQueue(env, env.__kv);
  eq((await loadDripQueue(env.__kv, 'anna')).length, 0, 'permanently skipped drip is dropped');

  // --- bad inputs never fan out ---
  const bad = await fanoutHighEdgeAlert(env, null, 'rec9', 'r');
  eq(bad.fanned + bad.dripped, 0, 'bad pick never fans out');
  const noKv = await fanoutHighEdgeAlert({}, mkPick('2099-01-01'), 'rec9', 'r');
  eq(noKv.dripped, 0, 'no kv store means no drip');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL: threw ' + (e && e.message)); process.exit(1); });
