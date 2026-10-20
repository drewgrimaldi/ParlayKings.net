// Tennis Grand Slam format: ATP Slams = best-of-5, WTA always best-of-3.
// Tests the REAL bundle functions by extracting them from ../src/index.js
// (never a copy). Runs under plain node, no dependencies.
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

for (const v of ['var GRAND_SLAM_NAME_RE']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['normalizeLeague', 'isTennisGrandSlam', 'tennisMatchBestOf']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}

// --- Slam name detection (incl. ESPN naming variants) ---
check('Australian Open is a Slam', isTennisGrandSlam('Australian Open'), true);
check('Wimbledon is a Slam', isTennisGrandSlam('Wimbledon'), true);
check('Roland-Garros is a Slam', isTennisGrandSlam('Roland-Garros'), true);
check('Roland Garros is a Slam', isTennisGrandSlam('Roland Garros'), true);
check('French Open is a Slam', isTennisGrandSlam('French Open'), true);
check('US Open is a Slam', isTennisGrandSlam('US Open'), true);
check('U.S. Open is a Slam', isTennisGrandSlam('U.S. Open'), true);
check('lowercase australian open is a Slam', isTennisGrandSlam('australian open'), true);
check('Mifel Tennis Open is NOT a Slam', isTennisGrandSlam('Mifel Tennis Open'), false);
check('BNP Paribas Open is NOT a Slam', isTennisGrandSlam('BNP Paribas Open'), false);
check('Dallas Open is NOT a Slam', isTennisGrandSlam('Dallas Open'), false);
check('null is NOT a Slam', isTennisGrandSlam(null), false);
check('empty string is NOT a Slam', isTennisGrandSlam(''), false);
check('undefined is NOT a Slam', isTennisGrandSlam(undefined), false);

// --- Format selection ---
check('ATP at Australian Open = best-of-5', tennisMatchBestOf('TENNIS', 'Australian Open'), 5);
check('ATP at Wimbledon = best-of-5', tennisMatchBestOf('TENNIS', 'Wimbledon'), 5);
check('ATP at Roland-Garros = best-of-5', tennisMatchBestOf('TENNIS', 'Roland-Garros'), 5);
check('ATP at US Open = best-of-5', tennisMatchBestOf('TENNIS', 'US Open'), 5);
check('ATP at regular event = best-of-3', tennisMatchBestOf('TENNIS', 'Mifel Tennis Open'), 3);
check('ATP unknown tournament = best-of-3', tennisMatchBestOf('TENNIS', null), 3);
check('WTA at Australian Open = best-of-3', tennisMatchBestOf('WTA', 'Australian Open'), 3);
check('WTA at Wimbledon = best-of-3', tennisMatchBestOf('WTA', 'Wimbledon'), 3);
check('WTA at US Open = best-of-3', tennisMatchBestOf('WTA', 'US Open'), 3);
check('WTA at regular event = best-of-3', tennisMatchBestOf('WTA', 'Mifel Tennis Open'), 3);
check('ITF at a Slam-named event = best-of-3', tennisMatchBestOf('ITF', 'Wimbledon'), 3);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('All tennis slam-format tests passed.');
