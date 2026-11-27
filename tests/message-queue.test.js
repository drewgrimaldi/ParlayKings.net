// Queued follow-ups: while a response is still being generated, hitting
// Enter (or tapping send) must stash the typed text in a visible queue
// instead of dropping it, then fire each queued message in FIFO order.
// Runs under plain node, no dependencies. Tests the REAL send/renderQueue
// by extracting them from ../src/index.js (never a copy), against a
// minimal fake DOM.
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

// ---- minimal fake DOM (id registry mirrors real getElementById) ----
const byId = {};
function makeEl(tag) {
  const el = {
    tag, children: [], parentNode: null, className: '',
    textContent: '', value: '', disabled: false, style: { height: '' },
    attrs: {}, onclick: null, classList: { add() {}, remove() {} },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(n, ref) { n.parentNode = el; const i = el.children.indexOf(ref); if (i < 0) el.children.push(n); else el.children.splice(i, 0, n); return n; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); if (el.id && byId[el.id] === el) delete byId[el.id]; },
    setAttribute(k, v) { el.attrs[k] = v; },
    focus() {},
    closest() { return rowEl; },
  };
  let _id = '';
  Object.defineProperty(el, 'id', {
    get() { return _id; },
    set(v) { if (_id && byId[_id] === el) delete byId[_id]; _id = v; if (v) byId[v] = el; },
  });
  Object.defineProperty(el, 'firstChild', { get() { return el.children.length ? el.children[0] : null; } });
  return el;
}
const document = {
  getElementById(id) { return byId[id] || null; },
  createElement(tag) { return makeEl(tag); },
};
const appEl = makeEl('div');
const rowEl = makeEl('div');
appEl.appendChild(rowEl);
const input = makeEl('textarea');
input.id = 'input';
rowEl.appendChild(input);
const sendBtn = makeEl('button');
sendBtn.id = 'send-btn';
rowEl.appendChild(sendBtn);

// ---- network + chat collaborators ----
const fetchCalls = [];
let releasers = [];
globalThis.fetch = (url, opts) => {
  fetchCalls.push(JSON.parse(opts.body).message);
  return new Promise((res) => {
    releasers.push(() => res({ json: async () => ({ reply: 'R:' + fetchCalls.length }) }));
  });
};
const userMsgs = [];
async function addMsg(who, text) { if (who === 'user') userMsgs.push(text); }
function showThinking() {}
function renderReasoning() {}
function addPaywallMsg() {}
async function typeMsg() {}
function saveConvoTurn() {}
function updateSpins() {}

// ---- load the REAL code under test ----
// NOTE: var (not let/const): bindings from direct eval must land in this
// scope, and only var/function declarations do that.
eval('var busy = false; var QUEUE_MAX = 5; var msgQueue = [];');
eval('var notifyArmed = false;');
async function enqueueBgJob() { throw new Error('notify armed in queue test'); }
eval('var selectedProvider = \'meta\';');
eval('var conversationHistory = [];');
eval(extract('renderQueue'));
eval(extract('send'));

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}
const drain = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function queueTexts() {
  const box = document.getElementById('msg-queue');
  if (!box) return [];
  return box.children.map((row) => row.children[1].textContent);
}

(async () => {
  // 1. idle send posts immediately, no queue UI left behind.
  input.value = 'Q1';
  const p1 = send();
  eq(fetchCalls.length, 1, 'idle send fires fetch immediately');
  eq(fetchCalls[0], 'Q1', 'idle send posts the typed text');
  releasers.shift()(); await p1;
  eq(document.getElementById('msg-queue'), null, 'no queue box after plain send');
  eq(input.value, '', 'input cleared after send');

  // 2. typing while busy queues instead of dropping.
  input.value = 'Q2';
  const p2 = send();
  eq(fetchCalls.length, 2, 'second send starts request');
  input.value = 'Q3 while busy';
  await send();
  eq(fetchCalls.length, 2, 'busy send fires no new request');
  eq(input.value, '', 'busy send clears the input');
  eq(JSON.stringify(queueTexts()), JSON.stringify(['Q3 while busy']), 'typed text waits in visible queue');

  // 3. finishing the in-flight turn auto-fires the queued message, in order.
  releasers.shift()(); await p2; await drain();
  releasers.shift()(); await drain();
  eq(JSON.stringify(fetchCalls), JSON.stringify(['Q1', 'Q2', 'Q3 while busy']), 'queued message fires after current turn, FIFO');
  eq(JSON.stringify(userMsgs), JSON.stringify(['Q1', 'Q2', 'Q3 while busy']), 'user bubbles appear in send order');
  eq(document.getElementById('msg-queue'), null, 'queue box removed once drained');

  // 4. queue caps at 5; overflow text stays in the input, nothing lost.
  input.value = 'B0';
  const pb = send();
  for (let i = 1; i <= 5; i++) { input.value = 'C' + i; await send(); }
  eq(msgQueue.length, 5, 'queue holds at most 5');
  input.value = 'OVERFLOW';
  await send();
  eq(msgQueue.length, 5, 'overflow does not grow the queue');
  eq(input.value, 'OVERFLOW', 'overflow text stays in the input');
  eq(fetchCalls.length, 4, 'overflow fires no request');
  while (releasers.length) { releasers.shift()(); await drain(); }
  await drain();
  eq(msgQueue.length, 0, 'backlog drains after cap test');
  eq(input.value, 'OVERFLOW', 'overflow draft kept in input, never silently dropped');
  const po = send();
  while (releasers.length) { releasers.shift()(); await drain(); }
  await drain();
  await po;
  eq(fetchCalls[fetchCalls.length - 1], 'OVERFLOW', 'kept draft sends on the next tap');

  // 5. queued rows can be cancelled via their remove button.
  input.value = 'K1';
  const pk = send();
  input.value = 'KEEP';
  await send();
  input.value = 'DROP';
  await send();
  let box = document.getElementById('msg-queue');
  const dropBtn = box.children[1].children[2];
  dropBtn.onclick();
  eq(JSON.stringify(queueTexts()), JSON.stringify(['KEEP']), 'remove button drops that row');
  releasers.shift()(); await pk; await drain();
  releasers.shift()(); await drain();
  eq(fetchCalls[fetchCalls.length - 1], 'KEEP', 'cancelled message never sends');
  eq(fetchCalls.includes('DROP'), false, 'dropped text fires no request');

  // 6. queued text is rendered as text, never HTML.
  input.value = 'M1';
  const pm = send();
  input.value = '<img src=x onerror=alert(1)>';
  await send();
  box = document.getElementById('msg-queue');
  eq(box.children[0].children[1].textContent, '<img src=x onerror=alert(1)>', 'queued markup kept as literal text');
  eq(extract('renderQueue').includes('innerHTML'), false, 'queue renderer builds DOM nodes, no innerHTML');
  while (releasers.length) { releasers.shift()(); await drain(); }
  await drain();

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); process.exit(1); });
