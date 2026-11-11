// Tap-to-open resume: tapping a "prediction ready" notification opens ?job=
// on a FRESH page (new convoId, empty seen/rendered maps). That load must
// adopt the job's chat, render the finished reply, and — if storage still
// reads stale-pending — keep watching instead of going deaf with eternal
// dots. Runs under plain node, no dependencies. Tests the REAL
// resumeBgJobs/pollBgJobs/renderBgJob extracted from ../src/index.js (never
// a copy); only DOM leaves and network are stubbed.
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

// ---- fakes ----
let thinkingShown = false;
const userMsgs = [];
const aiMsgs = [];
const typedCalls = [];
const reasonedCalls = [];
const document = {
  getElementById(id) {
    if (id === 'thinking') return thinkingShown ? { remove() { thinkingShown = false; } } : null;
    if (id === 'input') return { value: '', style: {}, focus() {} };
    return null;
  },
  createElement() { return { appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; },
};
var location = { search: '' };
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const fetchUrls = [];
let jobScript = [];
let mineScript = [];
globalThis.fetch = async (url) => {
  fetchUrls.push(url);
  if (url.indexOf('/api/job?') === 0) {
    const next = jobScript.shift();
    if (!next) throw new Error('unexpected /api/job fetch');
    return { ok: true, json: async () => next };
  }
  const next = mineScript.shift();
  if (!next) throw new Error('unexpected /api/jobs/mine fetch');
  return { ok: true, json: async () => next };
};
function showThinking() { thinkingShown = true; }
function addMsg(who, text) { (who === 'user' ? userMsgs : aiMsgs).push(text); }
async function typeMsg(text, userQ, provider) { await new Promise((r) => setTimeout(r, 30)); typedCalls.push({ text, userQ, provider }); }
function renderReasoning(text) { reasonedCalls.push(text); }
function addPaywallMsg() {}
function updateSpins() {}

// ---- load the REAL code under test ----
eval('var convoId = \'fresh\';');
eval('var selectedProvider = \'meta\';');
eval('var conversationHistory = [];');
eval('var seenBgJobs = {};');
eval('var renderedBgJobs = {};');
eval('var startedBgJobs = {};');
eval('var resumedBgJobs = {};');
eval('var bgThinking = false;');
eval('var bgFirstSeen = 0;');
eval('var bgPollTimer = 0;');
eval('var BG_FRESH_MS = 30 * 60 * 1000;');
eval(extract('renderBgJob'));
eval(extract('pollBgJobs'));
eval(extract('resumeJob'));
eval(extract('resumeBgJobs'));

let pass = 0, fail = 0;
function show(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + show(actual) + ', want ' + show(expected) + ')'); }
}
const drain = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function reset() {
  thinkingShown = false;
  userMsgs.length = 0;
  aiMsgs.length = 0;
  typedCalls.length = 0;
  reasonedCalls.length = 0;
  fetchUrls.length = 0;
  conversationHistory = [];
  seenBgJobs = {};
  renderedBgJobs = {};
  startedBgJobs = {};
  resumedBgJobs = {};
  bgThinking = false;
  bgFirstSeen = 0;
  if (bgPollTimer) { clearInterval(bgPollTimer); bgPollTimer = 0; }
  jobScript = [];
  mineScript = [];
  convoId = 'fresh';
  location.search = '';
  for (const k of Object.keys(store)) delete store[k];
}
const doneJob = (over = {}) => Object.assign({
  id: 'j9', status: 'done', createdAt: 1, doneAt: Date.now(), convoId: 'c-chat',
  message: 'A vs B',
  result: { reply: 'TEAM A WINS', thinking: 'TRACE', provider: 'meta', paywall: false, predictionsLeft: 4 },
}, over);

(async () => {
  // 1. Tap with a finished job: adopts the chat and renders, no reload needed.
  reset();
  location.search = '?job=j9';
  jobScript = [doneJob()];
  thinkingShown = true;
  resumeBgJobs();
  await drain(150);
  eq(convoId, 'c-chat', 'tap adopts the job chat');
  eq(JSON.stringify(userMsgs), JSON.stringify(['A vs B']), 'tap shows the question');
  eq(typedCalls.length, 1, 'tap types the reply');
  eq(reasonedCalls.length, 1, 'tap renders the reasoning bubble');
  eq(thinkingShown, false, 'tap clears the dots');

  // 2. Tap while storage still reads stale-pending: keeps watching, renders late.
  reset();
  location.search = '?job=j9';
  localStorage.setItem('pk_bg', '1');
  jobScript = [Object.assign(doneJob(), { status: 'pending', doneAt: 0, result: null })];
  mineScript = [{ jobs: [] }, { jobs: [doneJob()] }];
  thinkingShown = true;
  bgThinking = true;
  bgFirstSeen = Date.now();
  resumeBgJobs();
  await drain(200);
  eq(convoId, 'c-chat', 'stale tap still adopts the chat');
  eq(fetchUrls.filter((u) => u.indexOf('/api/jobs/mine') === 0).length >= 2, true, 'stale tap keeps polling');
  eq(typedCalls.length, 1, 'late job renders without reload');
  eq(thinkingShown, false, 'dots cleared after late render');

  // 3. Normal load with a pending job: starts watching.
  reset();
  localStorage.setItem('pk_bg', '1');
  convoId = 'c1';
  mineScript = [{ jobs: [{ id: 'p1', status: 'pending', createdAt: 1, doneAt: 0, convoId: 'c1', message: 'Q' }] }, { jobs: [] }];
  resumeBgJobs();
  await drain(150);
  eq(fetchUrls.length >= 2, true, 'pending job starts the watcher');

  // 5. Stale-tab tap (no reload, no ?job= in the URL): the tap message
  // resumes inline on the already-open page.
  reset();
  jobScript = [doneJob()];
  thinkingShown = true;
  resumeJob('j9');
  await drain(150);
  eq(convoId, 'c-chat', 'stale tap adopts the job chat');
  eq(typedCalls.length, 1, 'stale tap types the reply without reload');
  eq(thinkingShown, false, 'stale tap clears the dots');

  // 6. Same-chat reopen: startup render + immediate re-poll — one render only.
  reset();
  localStorage.setItem('pk_bg', '1');
  convoId = 'c-chat';
  mineScript = [{ jobs: [doneJob()] }, { jobs: [doneJob()] }];
  resumeBgJobs();
  await drain(250);
  eq(typedCalls.length, 1, 'reopen renders the reply exactly once');
  eq(userMsgs.length, 1, 'reopen shows the question exactly once');
  // 7. Double delivery (SW message + ?job= URL): second resume is a no-op.
  reset();
  jobScript = [doneJob(), doneJob()];
  resumeJob('j9');
  resumeJob('j9');
  await drain(150);
  eq(typedCalls.length, 1, 'double resume types the reply exactly once');

  // 8. Tap while pending adopts a watch window (no eternal dots).
  reset();
  location.search = '?job=j9';
  jobScript = [Object.assign(doneJob(), { status: 'pending', doneAt: 0, result: null })];
  mineScript = [{ jobs: [] }];
  resumeBgJobs();
  await drain(150);
  eq(bgFirstSeen > 0, true, 'pending tap starts a watch window');
  // 9. Cross-chat reopen (2026-11-10): a job that finished in an earlier
  // visit, under a different chat, surfaces on a plain reopen — it used
  // to be skipped for belonging to another chat.
  reset();
  localStorage.setItem('pk_bg', '1');
  jobScript = [doneJob()];
  mineScript = [{ jobs: [doneJob()] }, { jobs: [doneJob()] }];
  resumeBgJobs();
  await drain(250);
  eq(convoId, 'c-chat', 'cross-chat reopen adopts the job chat');
  eq(typedCalls.length, 1, 'cross-chat reopen renders the reply once');
  eq(JSON.stringify(userMsgs), JSON.stringify(['A vs B']), 'cross-chat reopen shows the question');

  // 10. Cross-chat still-running job: this page adopts its chat and
  // starts watching instead of ignoring it.
  reset();
  localStorage.setItem('pk_bg', '1');
  mineScript = [{ jobs: [{ id: 'p9', status: 'running', createdAt: 1, doneAt: 0, convoId: 'c-run', message: 'Q2' }] }, { jobs: [] }];
  resumeBgJobs();
  await drain(150);
  eq(convoId, 'c-run', 'running cross-chat job hands its chat to this page');
  eq(fetchUrls.length >= 2, true, 'running cross-chat job starts the watcher');

  // 4. Quiet load: no flag, nothing pending — no polling, no noise.
  reset();
  resumeBgJobs();
  await drain(100);
  eq(fetchUrls.length, 0, 'quiet load fetches nothing');

  if (bgPollTimer) { clearInterval(bgPollTimer); bgPollTimer = 0; }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
