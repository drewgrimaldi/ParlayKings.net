// Password-reset helpers: runs under plain node, no dependencies. Tests the
// REAL isValidPassword and pwResetKey extracted from ../src/index.js
// (never a copy). Covers the self-serve forgot/reset flow guards.
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

eval(extract('isValidPassword'));
eval(extract('pwResetKey'));
eval(extract('pwResetThrottleKey'));

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

eq(isValidPassword('longenough'), true, '8+ chars accepted');
eq(isValidPassword('12345678'), true, 'exactly 8 accepted');
eq(isValidPassword('short'), false, 'short rejected');
eq(isValidPassword(''), false, 'empty rejected');
eq(isValidPassword(null), false, 'null rejected');
eq(isValidPassword(12345678), false, 'non-string rejected');
eq(pwResetKey('abc-123'), 'pwreset:abc-123', 'reset key namespaced');
eq(pwResetKey('ABC'), 'pwreset:ABC', 'reset key preserves token');
eq(pwResetThrottleKey('Drew'), 'pwrl:drew', 'throttle key lowercased');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
