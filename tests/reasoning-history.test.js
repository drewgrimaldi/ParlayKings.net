// Reasoning-bubble persistence: the collapsible "ParlayKings Reasoning"
// bubble (collapsed by default) must survive a history round-trip. Opening a
// saved chat used to drop it: saveConvoTurn never sent `thinking`, the server
// never stored it, and openConvo rendered only user/ai bubbles. Runs under
// plain node, no dependencies. Tests the REAL renderReasoning, openConvo,
// clearMessages and saveConvoTurn extracted from ../src/index.js (never a
// copy); only the DOM leaves and network are stubbed.
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

// ---- minimal fake DOM ----
const byId = {};
function matches(el, sel) {
  if (sel[0] === '#') return el.id === sel.slice(1);
  if (sel[0] === '.') return (el.className || '').split(' ').indexOf(sel.slice(1)) >= 0;
  return false;
}
function makeEl(tag) {
  const el = {
    tag, children: [], parentNode: null, className: '',
    textContent: '', value: '', disabled: false,
    style: {}, attrs: {}, listeners: {},
    scrollTop: 0, scrollHeight: 0,
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); if (el.id && byId[el.id] === el) delete byId[el.id]; },
    setAttribute(k, v) { el.attrs[k] = v; },
    addEventListener(ev, fn) { el.listeners[ev] = fn; },
    click() { if (el.listeners.click) el.listeners.click(); },
    querySelector(sel) {
      for (const c of el.children) {
        if (matches(c, sel)) return c;
        const deep = c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      for (const part of sel.split(',')) {
        const s = part.trim();
        for (const c of el.children) {
          if (matches(c, s)) out.push(c);
          out.push.apply(out, c.querySelectorAll(s));
        }
      }
      return out;
    },
    focus() {},
  };
  let _id = '';
  Object.defineProperty(el, 'id', {
    get() { return _id; },
    set(v) { if (_id && byId[_id] === el) delete byId[_id]; _id = v; if (v) byId[v] = el; },
  });
  return el;
}
const document = {
  getElementById(id) { return byId[id] || null; },
  createElement(tag) { return makeEl(tag); },
  createTextNode(text) { const el = makeEl('#text'); el.textContent = text; return el; },
};
const messagesBox = makeEl('div');
messagesBox.id = 'messages';

// ---- collaborators ----
const seq = [];
function addMsg(who, text) {
  seq.push('msg:' + who);
  const d = makeEl('div');
  d.className = 'msg ' + who;
  d.textContent = text;
  messagesBox.appendChild(d);
}
function convosUrl(p) { return p; }
function closeChatsDrawer() {}
function loadConvoList() {}
const savedBodies = [];
globalThis.fetch = async (url, opts) => {
  if (opts && opts.body) savedBodies.push(JSON.parse(opts.body));
  return { ok: true, json: async () => (fetchReply !== null ? fetchReply : { id: 'c1' }) };
};
let fetchReply = null;

// ---- load the REAL code under test ----
eval('var convoId = \'c1\';');
eval('var conversationHistory = [];');
eval('var pinsCache = { chats: {}, picks: {} };');
eval(extract('loadPins'));
eval(extract('tidyReasoningText'));
eval(extract('buildCachedThinking'));
eval(extract('renderReasoning'));
eval(extract('clearMessages'));
eval(extract('openConvo'));
eval(extract('saveConvoTurn'));

let pass = 0, fail = 0;
function show(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + show(actual) + ', want ' + show(expected) + ')'); }
}
function reasoningNodes() {
  return messagesBox.querySelectorAll('.reasoning-label').map((label) => ({
    label,
    box: label.parentNode.querySelector('.reasoning-box'),
    toggle: label.querySelector('.reasoning-toggle'),
  }));
}
function reset() {
  messagesBox.children.length = 0;
  seq.length = 0;
  savedBodies.length = 0;
  conversationHistory = [];
  convoId = 'c1';
  fetchReply = null;
}

(async () => {
  // 1. Bubble renders collapsed by default with the chain of thought inside.
  reset();
  renderReasoning('TRACE LINE 1\n\nTRACE LINE 2');
  let nodes = reasoningNodes();
  eq(nodes.length, 1, 'reasoning bubble rendered');
  eq(nodes[0].box.style.display, 'none', 'reasoning collapsed by default');
  eq(nodes[0].toggle.textContent, '▸', 'collapsed chevron shown');
  eq(nodes[0].box.textContent.indexOf('TRACE LINE 1') >= 0, true, 'chain of thought kept in bubble');

  // 2. Markup in thinking is literal text, never HTML.
  reset();
  renderReasoning('<img src=x onerror=alert(1)>');
  nodes = reasoningNodes();
  eq(nodes[0].box.textContent, '<img src=x onerror=alert(1)>', 'thinking markup kept as literal text');

  // 3. Clicking the label expands and collapses again.
  nodes[0].label.click();
  eq(nodes[0].box.style.display, '', 'click expands the bubble');
  eq(nodes[0].toggle.textContent, '▾', 'expanded chevron shown');
  nodes[0].label.click();
  eq(nodes[0].box.style.display, 'none', 'second click collapses again');
  eq(nodes[0].toggle.textContent, '▸', 'chevron back to collapsed');

  // 3b. Whitespace tidying keeps the long-standing display rules.
  eq(tidyReasoningText('a   b\t\tc'), 'a b c', 'space/tab runs collapse to one space');
  eq(tidyReasoningText('a\n\n\n\nb'), 'a\n\nb', '3+ newlines collapse to one blank line');
  eq(tidyReasoningText('  padded  '), 'padded', 'ends trimmed');

  // 4. Opening a saved chat restores the bubble (collapsed) in place.
  reset();
  fetchReply = { id: 'c9', turns: [
    { user: 'A vs B', reply: 'A WINS', thinking: 'SAVED TRACE' },
    { user: 'old q', reply: 'old a' },
  ] };
  await openConvo('c9');
  nodes = reasoningNodes();
  eq(nodes.length, 1, 'history open restores one reasoning bubble');
  eq(nodes[0].box.style.display, 'none', 'restored bubble collapsed by default');
  eq(nodes[0].box.textContent.indexOf('SAVED TRACE') >= 0, true, 'restored bubble holds saved chain of thought');
  eq(seq.join(','), 'msg:user,msg:ai,msg:user,msg:ai', 'bubbles render in turn order');
  eq(conversationHistory.length, 2, 'history keeps both turns');
  eq(conversationHistory[0].thinking, 'SAVED TRACE', 'history keeps thinking for follow-ups');
  eq(conversationHistory[1].thinking, '', 'legacy turn without thinking stays empty');

  // 5. Turns with no thinking render no bubble.
  reset();
  fetchReply = { id: 'c8', turns: [{ user: 'q', reply: 'a' }] };
  await openConvo('c8');
  eq(reasoningNodes().length, 0, 'no bubble when turn has no thinking');

  // 6. Saving a turn persists the thinking for the next open.
  reset();
  fetchReply = { id: 'c1' };
  await saveConvoTurn('A vs B', 'A WINS', 'LIVE TRACE');
  eq(savedBodies.length, 1, 'save posts one turn');
  eq(savedBodies[0].thinking, 'LIVE TRACE', 'save sends thinking to the server');
  eq(savedBodies[0].message, 'A vs B', 'save still sends the message');
  eq(savedBodies[0].reply, 'A WINS', 'save still sends the reply');

  // 6b. Cached replies carry a thinking basis so the bubble renders.
  const cachedText = buildCachedThinking({ matchup: 'A vs B', winner: 'A', teamAWinPct: 62, teamBWinPct: 38, modelVersion: 'SAM 1.6', eventDate: '2026-09-13', placedDate: '2026-09-13' });
  eq(typeof cachedText, 'string', 'cached thinking is text');
  eq(cachedText.indexOf('A vs B') >= 0 && cachedText.indexOf('62% / 38%') >= 0, true, 'cached thinking holds pick facts');
  eq(cachedText.indexOf('no new chain of thought') >= 0, true, 'cached thinking is labeled honestly');
  const thinText = buildCachedThinking({});
  eq(thinText.length > 0, true, 'cached thinking never empty even with a thin record');

  // 7. New chat clears bubbles (expected lifecycle, not the bug).
  reset();
  renderReasoning('GONE SOON');
  eq(reasoningNodes().length, 1, 'bubble present before clear');
  clearMessages();
  eq(reasoningNodes().length, 0, 'new chat clears reasoning bubbles');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
