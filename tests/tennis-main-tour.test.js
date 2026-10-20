// Main-tour-only tennis slate tests (2026-10-16).
//
// The daily tennis slate is restricted to ATP/WTA Tour main draws.
// ESPN's tennis scoreboards carry no tier field — Challenger, WTA 125,
// and ITF events arrive in the same payload as tour events — so the
// allowlist derives from The Odds API's active tennis catalog (events
// the books price = the mainstream tour; sub-tour keys name themselves
// and are excluded). These tests pin the pure matching logic.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
function check(label, cond) { if (cond) { passed++; } else { failed++; console.log('FAIL: ' + label); } }
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  let quote = null, lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const _cdStart = src.indexOf('const TENNIS_TOUR_GENERIC_TOKENS');
const constDecl = src.slice(_cdStart, src.indexOf(']);', _cdStart) + 3);
eval(constDecl + '\n' + ['tennisTokens', 'tennisSignatureFromKey', 'tennisMainTourSignatures', 'tennisTournamentAllowed'].map(extractFn).join('\n'));

const sportsList = [
  { key: 'tennis_wta_wuhan_open', active: true },
  { key: 'tennis_wta_ningbo_open', active: true },
  { key: 'tennis_wta_japan_open', active: true },
  { key: 'tennis_atp_shanghai_masters', active: true },
  { key: 'tennis_wta_french_open', active: true },
  { key: 'tennis_atp_indian_wells_open', active: true },
  { key: 'tennis_atp_challenger_lisbon', active: true },
  { key: 'tennis_wta_rovereto_125', active: true },
  { key: 'tennis_atp_us_open', active: false },
];
const sigs = tennisMainTourSignatures(sportsList);
check('signatures exclude challenger keys', !sigs.some((s) => s.includes('lisbon')));
check('signatures exclude 125 keys', !sigs.some((s) => s.includes('rovereto')));
check('signatures exclude inactive events', !sigs.some((s) => s.includes('us')));
check('Wuhan (sponsor name) allowed', tennisTournamentAllowed('Dongfeng Voyah Wuhan Open', sigs) === true);
check('Ningbo allowed', tennisTournamentAllowed('BNB Ningbo Open', sigs) === true);
check('Japan Open allowed', tennisTournamentAllowed('Kinoshita Group Japan Open', sigs) === true);
check('Shanghai Masters allowed', tennisTournamentAllowed('Rolex Shanghai Masters', sigs) === true);
check('Roland Garros matches the french_open key', tennisTournamentAllowed('Roland Garros', sigs) === true);
check('BNP Paribas Open matches indian_wells', tennisTournamentAllowed('BNP Paribas Open', sigs) === true);
check('Rovereto ITF not allowed', tennisTournamentAllowed('RoveretOpen Città della Pace', sigs) === false);
check('Lisboa ITF not allowed', tennisTournamentAllowed('Lisboa Belem Open', sigs) === false);
check('unknown tournament fails closed when a list exists', tennisTournamentAllowed('Some Random City Open', sigs) === false);
check('no list at all fails open (prompt rule still applies)', tennisTournamentAllowed('RoveretOpen Città della Pace', null) === true);
check('prompt carries the main-tour scope rule', src.includes('TENNIS SLATE SCOPE') && src.includes('MAIN TOUR ONLY'));
check('slate filter drops qualifying rounds', src.includes('/qualif/i.test(game.round'));
console.log(`tennis-main-tour: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
