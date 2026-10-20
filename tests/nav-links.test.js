// Nav drawer: trimmed podcast stack + GRIMALDI.TV under Trivia on every host.
//
// The hamburger drawer exists twice (shared samNetworkNavHtml plus the main
// chat page's inline copy) and both drifted back to a full podcast menu. The
// trimmed stack is HOME + EPISODES only, and the GRIMALDI.TV link sits under
// TRIVIA on every host. Assertions are scoped to the two drawer builders
// (release notes legitimately mention the old names). Runs under plain node.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function region1() {
  const s = src.indexOf('function samNetworkNavHtml');
  const e = src.indexOf('__name(samNetworkNavHtml');
  if (s < 0 || e < 0 || e <= s) throw new Error('drawer builder not found');
  return src.slice(s, e);
}
function region2() {
  const s = src.indexOf('const chatPodcastLinks');
  const e = src.indexOf('${sportsbookDrawerHtml()}');
  if (s < 0 || e < 0 || e <= s) throw new Error('chat drawer not found');
  return src.slice(s, e);
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

const regions = [region1(), region2()];
const gone = ['LIVE BROADCAST', 'PHOTO GALLERY', 'PODCAST MERCHANDISE', 'CLIP VAULT', 'FunnyPhotos', 'vault.grimaldi.tv', 'live.grimaldi.tv', 'grimaldi.tv/Blog', 'grimaldi.tv/Store'];
const kept = ['>HOME</a>', '>EPISODES</a>', '>TRIVIA</a>', '>GRIMALDI.TV</a>'];
regions.forEach((r, n) => {
  const tag = n === 0 ? 'shared drawer' : 'chat drawer';
  for (const g of gone) eq(r.includes(g), false, tag + ' drops ' + g);
  for (const k of kept) eq(r.includes(k), true, tag + ' keeps ' + k);
  eq(r.indexOf('>TRIVIA</a>') < r.indexOf('${grimUnderTrivia}'), true, tag + ' puts GRIMALDI.TV after TRIVIA');
});
const unconditional = 'const grimUnderTrivia = `<a class="nav-link" href="https://grimaldi.tv/">GRIMALDI.TV</a>`;';
eq(src.split(unconditional).length - 1, 2, 'GRIMALDI.TV unconditional on both builders');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
