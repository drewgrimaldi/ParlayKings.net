// Sportsbook drawer: books open the installed app via universal-link sportsbook
// URLs in a new tab, rows leave an odds slot for later, drawer carries 21+/RG
// messaging. Runs under plain node, no dependencies. Tests the REAL
// sportsbookDrawerHtml and sportsbookHeaderBtn extracted from
// ../src/index.js (never a copy).
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

eval(extract('sportsbookDrawerHtml'));

// The real book config from the bundle (never a copy): the extracted drawer
// closes over it, and affiliate swaps stay covered automatically.
{
  const at = src.indexOf('var SPORTSBOOKS = [');
  if (at < 0) throw new Error('SPORTSBOOKS config missing from bundle');
  eval(src.slice(at, src.indexOf('];', at) + 2));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}
function count(hay, needle) { return hay.split(needle).length - 1; }

(function () {
  const html = sportsbookDrawerHtml();

  // Five books, one row each, app-opening links.
  eq(count(html, 'book-row'), 5, 'five sportsbook rows');
  eq(count(html, 'target="_blank"'), 5, 'every book opens in a new tab');
  eq(count(html, 'rel="noopener"'), 5, 'every outbound row uses noopener');
  for (const u of [
    'https://sportsbook.fanduel.com',
    'https://sportsbook.draftkings.com',
    'https://sports.betmgm.com',
    'https://sportsbook.caesars.com',
    'https://sportsbook.fanatics.com',
  ]) eq(html.includes('href="' + u + '"'), true, 'row links ' + u);
  for (const n of ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'Fanatics']) {
    eq(html.includes('>' + n + '<'), true, 'row names ' + n);
  }

  // Odds slot per row, empty until the data wiring lands.
  eq(count(html, 'book-odds'), 5, 'every row leaves an odds slot');
  for (const id of ['fanduel', 'draftkings', 'betmgm', 'caesars', 'fanatics']) {
    eq(html.includes('data-book="' + id + '"'), true, 'odds slot keyed for ' + id);
  }

  // Required messaging and hidden-by-default drawer.
  eq(html.includes('21+'), true, 'drawer carries 21+ messaging');
  eq(html.includes('1-800-GAMBLER'), true, 'drawer carries responsible-gambling helpline');
  eq(html.includes('id="books-backdrop"'), true, 'drawer has a backdrop');
  eq(html.includes('hidden></div>') || html.includes('hidden'), true, 'backdrop starts hidden');
  eq(src.includes('translate(110%, -50%)'), true, 'drawer starts off-canvas right');
  eq(src.includes('width: min(250px'), true, 'drawer is narrow, not full-screen');
  eq(src.includes('max-height: min(72vh'), true, 'drawer is a compact card');
  eq(html.includes('>Sportsbooks<'), false, 'no visible Sportsbooks word');
  eq(html.includes('books-title'), false, 'no title element remains');
  eq(html.includes('onclick="closeBooksDrawer()"'), true, 'backdrop click closes the drawer');

  // Right-edge tab trigger, middle of the page.
  eq(html.includes('books-tab'), true, 'drawer ships a right-edge tab');
  eq(html.includes('>SPORTSBOOK<'), true, 'tab spells the whole word');
  eq(src.includes('.books-tab:hover'), true, 'tab tucks off-edge and reveals on hover');
  eq(src.includes('.books-tab:hover { right'), false, 'tab never moves under the finger');
  eq(src.includes('_booksAt'), false, 'no timed close-suppression fights quick taps');
  eq(src.includes('.books-tab::after'), true, 'invisible halo widens the tap target');
  eq(src.includes('z-index: 401'), true, 'tab sits above page layers');
  eq(count(html, 'toggleBooksDrawer(event)'), 2, 'tab opens the drawer');
  eq(src.includes('${sportsbookHeaderBtn()}'), false, 'no header trigger remains');
  eq(src.includes('.books-tab'), true, 'tab styling present');
  eq(src.includes('translateY(-50%)'), true, 'tab sits mid-page');
  eq(src.includes('${sportsbookDrawerHtml()}'), true, 'page renders the drawer');

  // Affiliate swap shape: per-book URL lives in one config object.
  eq(src.includes('var SPORTSBOOKS = ['), true, 'book URLs live in a config object');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
