// Background predictions + Web Push: VAPID auth, push tickets, job
// projection, and the cron job runner. Runs under plain node, no
// dependencies. Tests the REAL bundle functions by extracting them from
// ../src/index.js (never a copy). Crypto assertions use node:crypto as an
// independent oracle; network/KV are faked at the boundary.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

for (const fn of ['bgJobKey', 'pushSubKey', 'bgJobOwner', 'publicBgJob',
  'b64urlEncodeBytes', 'b64urlEncodeText', 'vapidAuthHeader',
  'sendPushTicket', 'replicaKv', 'processBgJobs', 'runBgJob']) {
  eval(extract(fn));
}
eval('var BGJOB_PREFIX = "bgjob:"; var BGJOB_MAX_PENDING = 3; var BGJOB_TTL = 86400; var PUSH_SUB_TTL = 7776000; var PUSHSUB_PREFIX = "pushsub:";');

// Internal-pipeline stub. Module scope (not inside the test body): the
// extracted runner resolves it through the scope chain, and var-declarations
// made by eval inside a function would NOT be visible to it.
const chatCalls = [];
const convoCalls = [];
let chatStubMode = 'ok';
eval('var ai_worker_current_default = { fetch: async (req) => { const u = new URL(req.url); if (u.pathname === "/api/chat") { chatCalls.push({ cookie: req.headers.get("cookie"), body: await req.json() }); if (chatStubMode === "fail") return new Response(JSON.stringify({ reply: "bad" }), { status: 500 }); return new Response(JSON.stringify({ reply: "BG-ANSWER", thinking: "T", provider: "meta", pick: { winner: "A" }, predictionsLeft: 4, spinsLeft: 4, version: "1.6" })); } if (u.pathname === "/api/convos/save") { convoCalls.push(await req.json()); return new Response(JSON.stringify({ ok: true, id: "c1" })); } return new Response("nope", { status: 404 }); } };');

// ---- fakes ----
function fakeKV() {
  const store = {};
  return {
    store,
    async get(k) { return k in store ? store[k] : null; },
    async put(k, v) { store[k] = String(v); },
    async delete(k) { delete store[k]; },
    async list({ prefix }) {
      return { keys: Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
  };
}

const realFetch = globalThis.fetch;
const pushCalls = [];
function stubPush(status = 201) {
  pushCalls.length = 0;
  globalThis.fetch = async (url, opts) => {
    pushCalls.push({ url, headers: opts.headers, body: opts.body });
    return { status };
  };
}
function restoreFetch() { globalThis.fetch = realFetch; }

// Test VAPID identity (generated here, never the production keys).
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privJwk = privateKey.export({ format: 'jwk' });
const pubJwk = publicKey.export({ format: 'jwk' });
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const testPub = b64u(Buffer.concat([Buffer.from([0x04]), Buffer.from(pubJwk.x, 'base64'), Buffer.from(pubJwk.y, 'base64')]));
const tenv = { VAPID_PRIVATE_KEY: JSON.stringify(privJwk), VAPID_PUBLIC_KEY: testPub, VAPID_SUBJECT: 'mailto:test@parlaykings.net' };
const testSub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x', auth: 'y' } };

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

(async () => {
  // Owner + keys.
  eq(bgJobKey('a1'), 'bgjob:a1', 'job key prefix');
  eq(pushSubKey('drew'), 'pushsub:drew', 'sub key prefix');
  eq(bgJobOwner({ username: 'drewgrimaldi' }), 'drewgrimaldi', 'owner from session');
  eq(bgJobOwner({}), '', 'no owner without username');
  eq(bgJobOwner({ username: 'a/b' }), '', 'owner rejects bad chars');
  eq(bgJobOwner(null), '', 'no owner without session');

  // Projection strips secrets, keeps the render payload.
  const pub = publicBgJob({ id: 'j1', status: 'done', owner: 'drew', cookie: 'secret', push: testSub, message: 'A vs B', result: { reply: 'R', thinking: 'T', provider: 'meta', pick: { winner: 'A' }, paywall: false, predictionsLeft: 4 } });
  eq(pub.cookie, undefined, 'projection drops session cookie');
  eq(pub.push, undefined, 'projection drops push endpoint');
  eq(pub.owner, undefined, 'projection drops owner');
  eq(pub.result.reply, 'R', 'projection keeps reply');
  eq(pub.result.pick.winner, 'A', 'projection keeps pick');

  // VAPID: header shape + real signature verification via node:crypto.
  const auth = await vapidAuthHeader(tenv, 'https://push.example.com');
  eq(auth.startsWith('vapid t='), true, 'vapid scheme');
  eq(auth.includes(',k=' + testPub), true, 'vapid carries public key');
  const jwt = auth.slice('vapid t='.length).split(',k=')[0];
  const [h, p, sSig] = jwt.split('.');
  eq(JSON.parse(Buffer.from(h, 'base64').toString()).alg, 'ES256', 'jwt alg');
  const payload = JSON.parse(Buffer.from(p, 'base64').toString());
  eq(payload.aud, 'https://push.example.com', 'jwt audience');
  eq(payload.exp > Date.now() / 1000, true, 'jwt expiry in future');
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(pubJwk.x, 'base64'), Buffer.from(pubJwk.y, 'base64')]);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sigBytes = Buffer.from(sSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, Buffer.from(h + '.' + p));
  eq(verified, true, 'jwt signature verifies against public key');

  // Push ticket request shape.
  stubPush(201);
  const code = await sendPushTicket(tenv, testSub);
  eq(code, 201, 'push status passthrough');
  eq(pushCalls.length, 1, 'one push request');
  eq(pushCalls[0].url, testSub.endpoint, 'push goes to subscription endpoint');
  eq(pushCalls[0].headers.TTL, '86400', 'push ttl header');
  eq(pushCalls[0].headers.Authorization.startsWith('vapid t='), true, 'push carries vapid auth');
  eq(pushCalls[0].body, undefined, 'payload-less ticket push');
  restoreFetch();

  // Cron runner: pending job -> internal /api/chat replay -> done + convo save + push.
  const kv = fakeKV();
  chatCalls.length = 0;
  convoCalls.length = 0;
  chatStubMode = 'ok';
  const benv = { SAM_BETS: kv, VAPID_PRIVATE_KEY: tenv.VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY: tenv.VAPID_PUBLIC_KEY, VAPID_SUBJECT: tenv.VAPID_SUBJECT };
  const ctx = { waitUntil() {} };
  const job = { id: 'job-1', owner: 'drew', message: 'A vs B', provider: 'meta', history: [], convoId: 'c1', cookie: 'sess=abc', push: testSub, status: 'pending', createdAt: Date.now() };
  await kv.put('bgjob:job-1', JSON.stringify(job));
  stubPush(201);
  await processBgJobs(benv, ctx);
  restoreFetch();
  const done = JSON.parse(await kv.get('bgjob:job-1'));
  eq(done.status, 'done', 'pending job completes');
  eq(done.result.reply, 'BG-ANSWER', 'result stored from replay');
  eq(chatCalls.length, 1, 'pipeline replayed once');
  eq(chatCalls[0].cookie, 'sess=abc', 'replay carries user session');
  eq(chatCalls[0].body.message, 'A vs B', 'replay carries the question');
  eq(convoCalls.length, 1, 'turn saved to convo server-side');
  eq(convoCalls[0].convoId, 'c1', 'convo save keeps the convo');
  eq(pushCalls.length, 1, 'push sent on completion');

  // Failed pipeline -> failed status, error kept, push still sent.
  chatStubMode = 'fail';
  const kv2 = fakeKV();
  const benv2 = { SAM_BETS: kv2, VAPID_PRIVATE_KEY: tenv.VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY: tenv.VAPID_PUBLIC_KEY, VAPID_SUBJECT: tenv.VAPID_SUBJECT };
  await kv2.put('bgjob:job-2', JSON.stringify({ id: 'job-2', owner: 'drew', message: 'X vs Y', provider: 'meta', history: [], convoId: 'c2', cookie: 'sess=abc', push: testSub, status: 'pending', createdAt: Date.now() }));
  stubPush(201);
  await processBgJobs(benv2, ctx);
  restoreFetch();
  const failed = JSON.parse(await kv2.get('bgjob:job-2'));
  eq(failed.status, 'failed', 'bad pipeline marks failed');
  eq(pushCalls.length, 1, 'push sent on failure too');

  // Retention: finished jobs past TTL are cleaned up.
  const kv3 = fakeKV();
  await kv3.put('bgjob:old', JSON.stringify({ id: 'old', owner: 'drew', status: 'done', doneAt: Date.now() - 2 * 86400 * 1000 }));
  await processBgJobs({ SAM_BETS: kv3 }, ctx);
  eq(await kv3.get('bgjob:old'), null, 'stale finished jobs deleted');

  // Service worker parses and covers push + click.
  const swStart = src.indexOf('var SW_JS = ');
  const swJoin = src.indexOf('].join(', swStart);
  const swEnd = src.indexOf('");', swJoin) + 3;
  eval(src.slice(swStart, swEnd));
  new vm.Script(SW_JS);
  console.log('ok: service worker parses');
  pass++;
  eq(SW_JS.includes('/api/jobs/mine'), true, 'sw pulls latest job');
  eq(SW_JS.includes('showNotification'), true, 'sw shows notification');
  eq(SW_JS.includes('notificationclick'), true, 'sw handles tap');
  eq(SW_JS.includes('pk-open-url'), true, 'tap hands the url to an open page');
  eq(SW_JS.includes('postMessage'), true, 'sw wakes a stale tab with the url');

  // Enqueue must start the job immediately: POST /api/jobs may not leave the
  // job sitting pending until the minutely cron (up to 60s of dead wait on
  // every bell-on message, even "hello").
  const postStart = src.indexOf('url.pathname === "/api/jobs"');
  const postEnd = src.indexOf('if (url.pathname', postStart + 10);
  const postBlock = src.slice(postStart, postEnd);
  eq(postBlock.includes('ctx.waitUntil(runBgJob(env, ctx, jobKv, job)'), true, 'enqueue kicks processing immediately');
  eq(src.includes('setInterval(pollBgJobs, 4000)'), true, 'done-poll is 4s');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); process.exit(1); });
