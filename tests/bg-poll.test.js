// Background poller regression: a freshly enqueued job is invisible to the
// first status poll (store lag), and that must NEVER clear the thinking dots
// or stop polling. Runs under plain node, no dependencies. Tests the REAL
// pollBgJobs/renderBgJob/enqueueBgJob extracted from ../src/index.js (never
// a copy); only the DOM leaves and network are stubbed.
const fs = require('fs');
const path = require('path');

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

for (const fn of ['pollBgJobs', 'renderBgJob', 'enqueueBgJob', 'ensurePushSub']) {
  eval(extract(fn));
}

// ---- fakes ----
let thinkingShown = false;
const aiMsgs = [];
const typedCalls = [];
const document = {
  getElementById(id) {
    if (id === 'thinking') {
      return thinkingShown ? { remove() { thinkingShown = false; } } : null;
    }
    if (id === 'input') return { value: '', style: {}, focus() {} };
    return null;
  },
  createElement() { return { appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; },
};
function showThinking() { thinkingShown = true; }
function addMsg(who, text) { if (who === 'user') userMsgs.push(text); else aiMsgs.push(text); }
const userMsgs = [];
async function typeMsg(text, userQ, provider) { typedCalls.push({ text, userQ, provider }); }
function renderReasoning() {}
function addPaywallMsg() {}
function updateSpins() {}
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const navigator = {};
let fetchScript = [];
globalThis.fetch = async () => {
  const next = fetchScript.shift();
  if (!next) throw new Error('unexpected fetch');
  if (next.throw) throw new Error(next.throw);
  return { ok: next.ok !== false, json: async () => next.body };
};

// ---- state under test (mirrors page scope) ----
var convoId = 'c1';
var selectedProvider = 'meta';
var conversationHistory = [];
var seenBgJobs = {};
var renderedBgJobs = {};
var startedBgJobs = {};
var resumedBgJobs = {};
var bgThinking = false;
var bgFirstSeen = 0;
var bgPollTimer = 0;
var BG_FRESH_MS = 30 * 60 * 1000;

let pass = 0, fail = 0;
function show(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + show(actual) + ', want ' + show(expected) + ')'); }
}
const drain = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const doneJob = {
  id: 'j1', status: 'done', createdAt: 1, doneAt: Date.now(), convoId: 'c1',
  message: 'A vs B',
  result: { reply: 'TEAM A WINS', thinking: '', provider: 'meta', pick: null, paywall: false, predictionsLeft: 4 },
};
function reset() {
  thinkingShown = false;
  aiMsgs.length = 0;
  userMsgs.length = 0;
  typedCalls.length = 0;
  conversationHistory = [];
  seenBgJobs = {};
  renderedBgJobs = {};
  startedBgJobs = {};
  resumedBgJobs = {};
  bgThinking = false;
  bgFirstSeen = 0;
  if (bgPollTimer) { clearInterval(bgPollTimer); bgPollTimer = 0; }
  fetchScript = [];
}

(async () => {
  // 1. REGRESSION: first poll sees nothing (store lag) -> dots stay, polling continues.
  reset();
  thinkingShown = true;
  bgThinking = true;
  bgFirstSeen = Date.now();
  fetchScript = [{ body: { jobs: [] } }];
  pollBgJobs();
  await drain();
  eq(thinkingShown, true, 'empty first poll keeps thinking dots');
  eq(bgPollTimer !== 0, true, 'empty first poll keeps watching');

  // 2. Late-appearing pending job keeps dots.
  fetchScript = [{ body: { jobs: [{ id: 'j9', status: 'pending', createdAt: 1, doneAt: 0, convoId: 'c1', message: 'Q' }] } }];
  pollBgJobs();
  await drain();
  eq(thinkingShown, true, 'pending job keeps thinking dots');

  // 3. Finished job renders exactly like foreground: typed reply, history, dots cleared, watch stopped.
  fetchScript = [{ body: { jobs: [doneJob] } }];
  pollBgJobs();
  await drain(150);
  eq(typedCalls.length, 1, 'done job types the reply');
  eq(typedCalls[0] && typedCalls[0].text, 'TEAM A WINS', 'reply text passed through');
  eq(typedCalls[0] && typedCalls[0].userQ, 'A vs B', 'user question passed through');
  eq(conversationHistory.length, 1, 'turn added to history');
  eq(thinkingShown, false, 'dots cleared after render');
  eq(bgPollTimer, 0, 'watch stopped when settled');

  // 4. Failed start clears dots and says so (no stuck bubble).
  reset();
  thinkingShown = true;
  bgThinking = true;
  fetchScript = [{ ok: false, body: { error: 'nope' } }];
  await enqueueBgJob('hello?');
  await drain();
  eq(thinkingShown, false, 'failed enqueue clears dots');
  eq(aiMsgs.some((m) => m.indexOf('nope') >= 0), true, 'failed enqueue explains why');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
