// Per-user pins: chats + individual picks in a KV profile record.
//
// The profile record (profile:<user-or-guest-ns>) holds pins plus reserved
// notify/settings sections for later features — no notification logic here.
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

for (const v of ['var MAX_CHAT_PINS', 'var MAX_PICK_PINS']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['profileKeyFor', 'defaultUserProfile', 'normalizeUserProfile',
  'sanitizeChatPinTitle', 'sanitizePickPin', 'pickPinKey',
  'pinChatPin', 'unpinChatPin', 'pinPickPin', 'unpinPickPin', 'prunePinsForConvo',
  'shortTeamName', 'formatAmerican', 'formatMoneyline', 'lineCacheKey', 'moneylineForPick']) {
  eval(extract(fn));
}

// Stub network + KV for the pinned-lines test.
let oddsCalls = 0;
async function fetchMarketOddsData(env, pick) {
  oddsCalls++;
  return { winnerPrice: -155, otherPrice: 135, otherName: 'Athletics' };
}
const lineStore = {};
const fakeLineKv = {
  get: async (k) => (k in lineStore ? lineStore[k] : null),
  put: async (k, v) => { lineStore[k] = v; }
};

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

(async function () {
  // Schema: versioned, pins plus reserved notify/settings sections.
  eq(profileKeyFor('drew'), 'profile:drew', 'profile key namespaced by user');
  eq(profileKeyFor('g-1234'), 'profile:g-1234', 'profile key works for guest ns');
  const d = defaultUserProfile();
  eq(d.v, 1, 'default profile versioned');
  eq(typeof d.pins.chats, 'object', 'default has chat pins map');
  eq(typeof d.pins.picks, 'object', 'default has pick pins map');
  eq(typeof d.notify, 'object', 'default reserves notify section');
  eq(typeof d.settings, 'object', 'default reserves settings section');
  eq(MAX_CHAT_PINS, 100, 'chat pin cap is 100');
  eq(MAX_PICK_PINS, 200, 'pick pin cap is 200');

  // Normalize: garbage in, clean profile out; over-cap trims oldest.
  eq(normalizeUserProfile(null).v, 1, 'null normalizes to default');
  eq(normalizeUserProfile({ pins: { chats: 42 } }).pins.chats && Object.keys(normalizeUserProfile({ pins: { chats: 42 } }).pins.chats).length, 0, 'non-object pins map emptied');
  const kept = normalizeUserProfile({ pins: { chats: 42 }, notify: { a: 1 } }).notify.a;
  eq(kept, 1, 'reserved notify section survives normalize');
  const fat = { pins: { chats: {}, picks: {} } };
  for (let i = 0; i < MAX_CHAT_PINS + 5; i++) fat.pins.chats['c' + i] = { pinnedAt: i, title: 't' };
  const slim = normalizeUserProfile(fat);
  eq(Object.keys(slim.pins.chats).length, MAX_CHAT_PINS, 'over-cap chats trimmed to cap');
  eq(slim.pins.chats['c0'], undefined, 'trim drops oldest first');

  // Chat pins: round trip, re-pin refreshes, cap enforced.
  const p1 = defaultUserProfile();
  eq(pinChatPin(p1, 'abc', 'My chat').ok, true, 'chat pin ok');
  eq(p1.pins.chats.abc.title, 'My chat', 'chat pin keeps title');
  eq(sanitizeChatPinTitle(''), 'Untitled chat', 'empty title defaulted');
  eq(unpinChatPin(p1, 'abc').ok, true, 'chat unpin ok');
  eq(p1.pins.chats.abc, undefined, 'chat pin removed');
  eq(unpinChatPin(p1, 'nope').ok, true, 'unpin missing chat still ok');
  const full = defaultUserProfile();
  for (let i = 0; i < MAX_CHAT_PINS; i++) full.pins.chats['c' + i] = { pinnedAt: i, title: 't' };
  eq(pinChatPin(full, 'new', 'x').ok, false, 'chat pin cap enforced');
  eq(pinChatPin(full, 'c0', 'retitled').ok, true, 're-pin under cap refreshes');
  eq(full.pins.chats.c0.title, 'retitled', 're-pin updates title');
  eq(pinChatPin(null, 'x', 'y').ok, false, 'chat pin rejects bad profile');

  // Pick pins: round trip, validation, cap, keys.
  eq(pickPinKey('c1', 123), 'c1:123', 'pick key is convo + turn time');
  const good = sanitizePickPin({ matchup: 'A vs B', winner: 'A', confidence: 64, league: 'NBA', eventDate: '2026-01-01', at: 99 });
  eq(good && good.matchup, 'A vs B', 'valid pick sanitized');
  eq(sanitizePickPin({ matchup: 'A', winner: '', confidence: 60, at: 1 }), null, 'pick without winner rejected');
  eq(sanitizePickPin({ matchup: 'A', winner: 'A', confidence: 'high', at: 1 }), null, 'pick without numeric confidence rejected');
  eq(sanitizePickPin({ matchup: 'A', winner: 'A', confidence: 60, at: -5 }), null, 'pick without valid time rejected');
  eq(sanitizePickPin(null), null, 'null pick rejected');
  const long = sanitizePickPin({ matchup: 'x'.repeat(500), winner: 'y'.repeat(500), confidence: 55, at: 7 });
  eq(long.matchup.length <= 200 && long.winner.length <= 120, true, 'pick fields length-capped');
  const p2 = defaultUserProfile();
  eq(pinPickPin(p2, 'c1:99', { matchup: 'A vs B', winner: 'A', confidence: 64, at: 99 }).ok, true, 'pick pin ok');
  eq(p2.pins.picks['c1:99'].winner, 'A', 'pick pin keeps winner');
  eq(pinPickPin(p2, 'c1:100', { matchup: '', winner: 'A', confidence: 1, at: 2 }).ok, false, 'bad pick pin rejected');
  eq(unpinPickPin(p2, 'c1:99').ok, true, 'pick unpin ok');
  eq(p2.pins.picks['c1:99'], undefined, 'pick pin removed');

  // Prune: deleting a chat drops its chat pin and all its pick pins.
  const p3 = defaultUserProfile();
  p3.pins.chats = { gone: { pinnedAt: 1, title: 'g' }, kept: { pinnedAt: 2, title: 'k' } };
  p3.pins.picks = { 'gone:11': { at: 11 }, 'gone:22': { at: 22 }, 'kept:33': { at: 33 } };
  prunePinsForConvo(p3, 'gone');
  eq(p3.pins.chats.gone, undefined, 'deleted chat pin pruned');
  eq(p3.pins.chats.kept.title, 'k', 'other chat pin kept');
  eq(p3.pins.picks['gone:11'], undefined, 'deleted chat pick pins pruned');
  eq(p3.pins.picks['kept:33'].at, 33, 'other chat pick pins kept');

  // Wiring: routes, persistence, list flags, UI hooks — and nothing else.
  eq(src.includes('url.pathname === "/api/pins" && request.method === "GET"'), true, 'pins GET route present');
  eq(src.includes('url.pathname === "/api/pins" && request.method === "POST"'), true, 'pins POST route present');
  eq(src.includes('if (turnPick) newTurn.pick = turnPick;'), true, 'save persists turn pick');
  eq(src.includes('prunePinsForConvo(await loadUserProfile(), id)'), true, 'convo delete prunes pins');
  eq(src.includes('pinned: !!listPins[c.id]'), true, 'convo list carries pinned flags');
  eq(src.includes("renderSection('Pinned')"), true, 'history renders pinned section');
  eq(src.includes('toggleChatPin(c.id, c.pinned)'), true, 'history rows toggle chat pins');
  eq(src.includes('togglePickPin(pinCtx.entry, pinCtx.pinned)'), true, 'message rows toggle pick pins');
  eq(src.includes('pick: turnPick'), true, 'client sends pick on save');

  // Pinned chats show the current moneyline instead of the date.
  eq(shortTeamName('Tampa Bay Rays'), 'Rays', 'short name takes last word');
  eq(shortTeamName('Athletics'), 'Athletics', 'single-word name intact');
  eq(formatAmerican(135), '+135', 'positive price gains a plus');
  eq(formatAmerican(-155), '-155', 'negative price unchanged');
  eq(formatAmerican(0), '0', 'zero price passes through');
  eq(formatMoneyline('Tampa Bay Rays', -155, 'Athletics', 135), 'Rays -155 | Athletics +135', 'moneyline formats pick-first');
  eq(lineCacheKey('Tampa Bay Rays vs Athletics'), 'linecache:tampa-bay-rays-vs-athletics', 'line cache key stable');
  const testPick = { matchup: 'Tampa Bay Rays vs Athletics', winner: 'Tampa Bay Rays', league: 'mlb' };
  const testLine = await moneylineForPick({}, fakeLineKv, testPick);
  eq(testLine, 'Rays -155 | Athletics +135', 'pinned line resolves from odds');
  eq(oddsCalls, 1, 'odds fetched once');
  eq(await moneylineForPick({}, fakeLineKv, testPick), testLine, 'repeat lookup served from KV cache');
  eq(oddsCalls, 1, 'cache prevents refetch');
  eq(await moneylineForPick({}, fakeLineKv, { matchup: 'x' }), null, 'incomplete pick returns null');
  eq(src.includes('lines: pinLines'), true, 'pins endpoint returns a lines map');
  eq(src.includes('moneylineForPick(env, convosKv, pinPick)'), true, 'pins endpoint resolves each pinned chat');
  eq(src.includes('li.dataset.convoId = c.id;'), true, 'history rows carry convo ids');
  eq(src.includes('applyPinLines();'), true, 'lines applied after pins and list render');
  eq(src.includes('loadPins();\n  loadConvoList();'), true, 'init loads pins alongside list so lines replace dates');
  eq(src.includes('dates.join("-")'), false, 'no ESPN date-range URL (ESPN 400s on ranges)');
  eq(src.includes('scoreboard?dates=${day}'), true, 'pinned lines fetch per-day scoreboards');
  eq(src.includes('Math.abs(numSpread) <= 35'), true, 'spread fallback skips moneyline-shaped details');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); process.exit(1); });
