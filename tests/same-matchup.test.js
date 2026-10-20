// Regression test for the nickname-key collision bug:
// "Michigan State vs Eastern Michigan" and "Michigan vs Washington State"
// both reduced to the nickname key "michigan|state", so a cached pick for
// one was served for the other. sameMatchup is now side-by-side.
// Runs under plain node, no dependencies. Tests the REAL functions by
// extracting them from ../src/index.js (never a copy).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

for (const fn of ['stripDiacritics', 'matchName', 'teamNickname', 'matchupNicknameKey',
  'splitMatchupSides', 'matchupSideMatches', 'sameMatchup',
  'extractMatchupHint', 'recordMatchesMessage']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + actual + ', want ' + expected + ')'); }
}

// The reported bug: distinct games must NOT match.
eq(sameMatchup('Michigan State vs Eastern Michigan', 'Michigan vs Washington State'), false, 'MSU/EMU vs Michigan/WashState differ');
eq(sameMatchup('Michigan State vs Eastern Michigan', 'Washington State vs Michigan'), false, 'MSU/EMU vs WashState/Michigan differ');
eq(sameMatchup('Ohio State vs Penn State', 'Michigan State vs Florida State'), false, 'other State-class collision differs');
eq(recordMatchesMessage({ fields: { 'Bet Label': 'Michigan vs Washington State' } }, 'give me a prediction for Michigan State vs Eastern Michigan'), false, 'recordMatchesMessage rejects the collision');

// Documented true pairs from the matchup-dedupe fix must keep matching.
eq(sameMatchup('Mercury vs Dream', 'Phoenix Mercury at Atlanta Dream'), true, 'Mercury/Dream rephrase matches');
eq(sameMatchup('Storm vs Liberty', 'Seattle Storm vs New York Liberty'), true, 'Storm/Liberty rephrase matches');
eq(sameMatchup('Dallas Wings vs Washington Mystics', 'Dallas Wings at Washington Mystics'), true, 'Wings/Mystics rephrase matches');
eq(sameMatchup('Mercury vs Dream', 'Dallas Wings vs Washington Mystics'), false, 'unrelated matchups stay distinct');

// Exact, reordered, and ESPN long-label (odds path) forms still match.
eq(sameMatchup('Eastern Michigan vs Michigan State', 'Michigan State vs Eastern Michigan'), true, 'reordered sides match');
eq(sameMatchup('Michigan State Spartans vs Eastern Michigan Eagles', 'Michigan State vs Eastern Michigan'), true, 'ESPN long labels match');
eq(sameMatchup('Michigan vs Ohio State', 'Ohio State vs Michigan'), true, 'reordered rivals match');
eq(sameMatchup('hello', 'Michigan vs Ohio State'), false, 'unparseable label never matches');
eq(recordMatchesMessage({ fields: { 'Bet Label': 'Phoenix Mercury at Atlanta Dream' } }, 'Phoenix Mercury at Atlanta Dream winner?'), true, 'recordMatchesMessage routes hint through sameMatchup');
// Everyday cache-hit path: same game asked twice still hits.
eq(sameMatchup('Michigan State vs Eastern Michigan', 'Michigan State vs Eastern Michigan prediction'), true, 'repeat query still cache-hits');
// NOTE: a noisy short message against a long differently-worded label
// ('Mercury vs Dream winner?' vs 'Phoenix Mercury at Atlanta Dream') no
// longer cache-hits. Accepted: it only costs one extra model run, and the
// write-time dupe guard (which compares the model's clean pick label)
// still catches the duplicate. Serving the wrong game is worse.
eq(recordMatchesMessage({ fields: { 'Bet Label': 'Mercury vs Dream' } }, 'mercury dream'), true, 'recordMatchesMessage no-hint fallback preserved');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
