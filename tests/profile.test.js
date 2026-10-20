// User profiles: notify prefs, settings, avatar validation, modal HTML.
//
// The KV profile record extends the pins store with notification prefs and
// settings; avatar bytes go to R2 (absent here) with MIME/size/dimension
// checks. Tests the REAL bundle functions by extracting them from
// ../src/index.js (never a copy). Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
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

for (const v of ['var MAX_AVATAR_BYTES', 'var MAX_AVATAR_DIM', 'var PROFILE_LEAGUES', 'var GAME_TEAM_KEYS', 'var PROFILE_TEAMS']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['readU16BE', 'readU32BE', 'sniffAvatarMime', 'parseImageDimensions',
  'sanitizeNotifyPrefs', 'sanitizeProfileSettings', 'profileEsc', 'profileModalHtml', 'chatsFootHtml']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}
const U8 = (arr) => Uint8Array.from(arr);

(function () {
  eq(MAX_AVATAR_BYTES, 2097152, 'avatar cap is 2 MB');
  eq(MAX_AVATAR_DIM, 2048, 'avatar dimension cap is 2048');
  eq(PROFILE_LEAGUES.length >= 10, true, 'league toggle list covers the sports');

  // MIME sniffing by magic bytes, not declared type.
  const png = U8([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const jpg = U8([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = U8([71, 73, 70, 56, 57, 97, 32, 0, 16, 0, 0, 0]);
  const webp = U8([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  const txt = U8([60, 104, 116, 109, 108, 62, 0, 0, 0, 0, 0, 0]);
  eq(sniffAvatarMime(png), 'image/png', 'png magic sniffed');
  eq(sniffAvatarMime(jpg), 'image/jpeg', 'jpeg magic sniffed');
  eq(sniffAvatarMime(gif), 'image/gif', 'gif magic sniffed');
  eq(sniffAvatarMime(webp), 'image/webp', 'webp magic sniffed');
  eq(sniffAvatarMime(txt), null, 'html masquerading as image rejected');
  eq(sniffAvatarMime(U8([1, 2, 3])), null, 'truncated file rejected');

  // Dimension parsing from headers (no full decode).
  const pngBox = U8([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 0, 200]);
  const pngDims = parseImageDimensions(pngBox, 'image/png');
  eq(pngDims && pngDims.w, 256, 'png width parsed');
  eq(pngDims && pngDims.h, 200, 'png height parsed');
  const gifBox = U8([71, 73, 70, 56, 57, 97, 32, 0, 16, 0, 0, 0]);
  const gifDims = parseImageDimensions(gifBox, 'image/gif');
  eq(gifDims && gifDims.w, 32, 'gif width parsed');
  eq(gifDims && gifDims.h, 16, 'gif height parsed');
  const jpgBox = U8([255, 216, 255, 192, 0, 11, 8, 0, 100, 0, 200, 1, 2, 3]);
  const jpgDims = parseImageDimensions(jpgBox, 'image/jpeg');
  eq(jpgDims && jpgDims.w, 200, 'jpeg width parsed');
  eq(jpgDims && jpgDims.h, 100, 'jpeg height parsed');
  const vp8 = U8([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0, 157, 1, 42, 0, 0, 0, 64, 1, 200, 0]);
  const vp8Dims = parseImageDimensions(vp8, 'image/webp');
  eq(vp8Dims && vp8Dims.w, 320, 'webp vp8 width parsed');
  eq(vp8Dims && vp8Dims.h, 200, 'webp vp8 height parsed');
  const vp8l = U8([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 0, 0, 0, 0, 47, 99, 192, 14, 0, 0]);
  const vp8lDims = parseImageDimensions(vp8l, 'image/webp');
  eq(vp8lDims && vp8lDims.w, 100, 'webp vp8l width parsed');
  eq(vp8lDims && vp8lDims.h, 60, 'webp vp8l height parsed');
  eq(parseImageDimensions(U8([1, 2, 3, 4]), 'image/png'), null, 'garbage dims rejected');
  eq(parseImageDimensions(pngBox, 'image/bmp'), null, 'unknown mime rejected');

  // Notify prefs: strict types, clamped ranges, valid hours only.
  const nd = sanitizeNotifyPrefs(null);
  eq(nd.enabled, false, 'notify defaults off');
  eq(nd.minConfidence, 60, 'notify default threshold 60');
  eq(sanitizeNotifyPrefs({ enabled: 1 }).enabled, false, 'enabled coerces strictly');
  eq(sanitizeNotifyPrefs({ enabled: true }).enabled, true, 'enabled true accepted');
  eq(sanitizeNotifyPrefs({ minConfidence: 30 }).minConfidence, 50, 'threshold floored at 50');
  eq(sanitizeNotifyPrefs({ minConfidence: 200 }).minConfidence, 100, 'threshold capped at 100');
  eq(sanitizeNotifyPrefs({ minConfidence: 'high' }).minConfidence, 60, 'non-numeric threshold defaulted');
  eq(sanitizeNotifyPrefs({ minConfidence: 72.6 }).minConfidence, 73, 'threshold rounded');
  const qh = sanitizeNotifyPrefs({ quietHours: { start: '22:00', end: '07:00' } }).quietHours;
  eq(qh.start, '22:00', 'quiet start kept');
  eq(qh.end, '07:00', 'quiet end kept');
  eq(sanitizeNotifyPrefs({ quietHours: { start: '25:99', end: 'x' } }).quietHours.start, null, 'bad quiet time nulled');
  const many = { leagues: {} };
  for (let i = 0; i < 35; i++) many.leagues['L' + i] = true;
  eq(Object.keys(sanitizeNotifyPrefs(many).leagues).length, 30, 'league map capped at 30');
  eq(sanitizeNotifyPrefs({ leagues: { NBA: 1 } }).leagues.NBA, false, 'league values coerce strictly');

  // Settings: trimmed display name only — avatar is server-managed.
  eq(sanitizeProfileSettings(null).displayName, '', 'settings default empty');
  eq(sanitizeProfileSettings({ displayName: '  Drew  ' }).displayName, 'Drew', 'display name trimmed');
  eq(sanitizeProfileSettings({ displayName: 'x'.repeat(100) }).displayName.length, 40, 'display name capped at 40');
  eq(sanitizeProfileSettings({ displayName: 'D', avatar: { key: 'evil' } }).avatar, null, 'client cannot set avatar');

  // Modal HTML: controls present, values escaped, upload gated on R2.
  eq(profileEsc('<script>"&').includes('<'), false, 'escaper strips markup');
  const off = profileModalHtml({ notify: {}, settings: {}, avatars: false });
  eq(off.includes('not enabled yet'), true, 'upload disabled note when R2 absent');
  eq(off.includes('pf-avatar-file'), false, 'no file input when R2 absent');
  const evil = profileModalHtml({ notify: { leagues: { NBA: true }, minConfidence: 70, quietHours: { start: '22:00', end: null } }, settings: { displayName: '<script>alert(1)</script>', avatar: { contentType: 'image/jpeg' } }, avatars: true });
  eq(evil.includes('<script>'), false, 'display name escaped in modal');
  eq(evil.includes('&lt;script&gt;'), true, 'escaped name present');
  eq(evil.includes('pf-avatar-img'), true, 'avatar preview shown when set');
  eq(evil.includes('pf-avatar-remove'), true, 'avatar remove offered when set');
  eq(evil.includes('data-league="NBA" checked'), true, 'league toggle reflects prefs');
  eq(evil.includes('value="70"'), true, 'threshold value rendered');
  eq(evil.includes('value="22:00"'), true, 'quiet hours rendered');

  // Wiring: profile + avatar routes exist and degrade without R2.
  eq(src.includes('url.pathname === "/api/profile" && request.method === "GET"'), true, 'profile GET route present');
  eq(src.includes('url.pathname === "/api/profile" && request.method === "POST"'), true, 'profile POST route present');
  eq(src.includes('url.pathname === "/api/profile/avatar" && request.method === "POST"'), true, 'avatar upload route present');
  eq(src.includes('url.pathname === "/api/profile/avatar" && request.method === "GET"'), true, 'avatar serve route present');
  eq(src.includes('url.pathname === "/api/profile/avatar" && request.method === "DELETE"'), true, 'avatar delete route present');
  eq(src.includes('Avatar uploads are not enabled yet'), true, 'upload degrades gracefully without R2');
  eq(src.includes('openProfileModal()'), true, 'drawer opens profile modal');

  // Footer: signed-in users get the gold profile button on the left, no username chip.
  const footIn = chatsFootHtml({ username: 'drewgrimaldi' });
  eq(footIn.includes('acct-in'), false, 'signed-in footer drops the username chip');
  eq(footIn.includes('drewgrimaldi'), false, 'signed-in footer shows no username text');
  eq(footIn.includes('id="profile-btn" class="foot-left"'), true, 'signed-in profile button moves to the left');
  eq(footIn.includes('id="notify-btn"'), true, 'signed-in footer keeps notifications');
  eq(footIn.includes('nav-toggle'), true, 'signed-in footer keeps the menu button');
  const footOut = chatsFootHtml(null);
  eq(footOut.includes('href="/login"'), true, 'guest footer keeps the Login link');
  eq(footOut.includes('id="profile-btn" class="foot-left"'), true, 'guest profile button parks bottom-left too');
  eq(footOut.includes('acct-in'), false, 'guest footer has no username chip either');
  eq(src.includes('#profile-btn svg { fill: #D4AF37; }'), true, 'profile button icon is gold');
  eq(src.includes('#profile-btn.foot-left'), true, 'left-side footer rule present');
  eq(footIn.includes('id="notify-cap"'), true, 'bell carries On/Off caption');
  eq(footIn.includes('>See More<'), true, 'menu carries See More caption');
  eq(footOut.includes('>See More<'), true, 'guest menu carries See More caption');
  eq(src.includes('async function refreshFootAvatar('), true, 'avatar refresh helper present');
  eq(src.includes('function avatarImgRetry('), true, 'avatar img retry helper present');
  eq(src.includes('function paintFootAvatarNow('), true, 'optimistic footer paint present');
  eq(src.includes('avatarImgRetry(this)'), true, 'avatar images self-retry on transient misses');
  eq(src.includes('openProfileModal(true,'), true, 'save re-opens modal expecting avatar');
  eq(src.includes('refreshFootAvatar(true,'), true, 'save refresh expects avatar');
  eq(evil.includes('pf-avatar-upload'), false, 'no separate upload button — photo rides Save');
  eq(evil.includes('press Save'), true, 'photo hint points at Save');
  eq(src.includes('pendingPhoto'), true, 'save uploads a pending photo first');
  eq(src.includes('openProfileModal(false,'), true, 'delete re-opens modal expecting no avatar');
  eq(src.includes('ok: true, avatar:'), true, 'avatar upload responds with avatar facts');
  eq(src.includes('#profile-btn img'), true, 'avatar fills profile button');
  eq(src.includes('cap.classList'), true, 'caption syncs with bell state');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
