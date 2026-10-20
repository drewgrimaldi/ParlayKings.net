// Grader 50/50-rule enforcement + tennis/WTA label standardization.
// (1) Drew's 50/50 rule: a pick logged at exactly 50% confidence must grade
// as Push, never Win/Loss — even when the model named a side. Tests the real
// isConfidenceFiftyFifty() from ../src/index.js (never a copy) plus
// source-level assertions that gradePendingBets enforces it.
// (2) Women's tennis must log as WTA everywhere going forward: the [PICK]
// tag format and both tool league enums must carry the Tennis=men's-ATP-only
// / WTA=all-women's-matches rule. Runs under plain node, no dependencies.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

function fnBody(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

// ---- 1. isConfidenceFiftyFifty behavior (confidence stored as fraction) ----
eval(fnBody('isConfidenceFiftyFifty'));
eq(isConfidenceFiftyFifty(0.5), true, '0.5 fraction is fifty-fifty');
eq(isConfidenceFiftyFifty(0.50), true, '0.50 fraction is fifty-fifty');
eq(isConfidenceFiftyFifty('0.5'), true, 'string "0.5" is fifty-fifty');
eq(isConfidenceFiftyFifty(0.5000001), true, 'float dust still counts as fifty-fifty');
eq(isConfidenceFiftyFifty(0.55), false, '0.55 is not fifty-fifty');
eq(isConfidenceFiftyFifty(0.49), false, '0.49 is not fifty-fifty');
eq(isConfidenceFiftyFifty(0.51), false, '0.51 is not fifty-fifty');
eq(isConfidenceFiftyFifty(0.6), false, '0.6 is not fifty-fifty');
eq(isConfidenceFiftyFifty(50), false, 'whole 50 (not a fraction) is not fifty-fifty');
eq(isConfidenceFiftyFifty(undefined), false, 'undefined is not fifty-fifty');
eq(isConfidenceFiftyFifty(null), false, 'null is not fifty-fifty');
eq(isConfidenceFiftyFifty(''), false, 'empty string is not fifty-fifty');
eq(isConfidenceFiftyFifty(NaN), false, 'NaN is not fifty-fifty');

// ---- 2. gradePendingBets enforces the rule at grade time ----
// NOTE: 'gradePendingBets' is also named inside CHANGELOG prose, so match
// the real definition (newline + async) rather than the first mention.
function fnBodyAsync(name) {
  const start = src.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}
const grader = fnBodyAsync('gradePendingBets');
eq(grader.includes('isConfidenceFiftyFifty(f["Confidence %"])'), true,
  'grader checks confidence fifty-fifty when assigning Result');
// The confidence-50 Push branch must come before the walkover/winner branches
// so a completed 50%-confidence game can never fall through to Win/Loss.
const confIdx = grader.indexOf('isConfidenceFiftyFifty(f["Confidence %"])');
const walkIdx = grader.indexOf('result.walkover || result.isTie');
const winIdx = grader.indexOf('namesLooselyMatch(f["Picked Winner"], result.winnerName)');
eq(confIdx > 0 && confIdx < walkIdx && confIdx < winIdx, true,
  'confidence-50 Push branch precedes walkover and Win/Loss branches');
eq(grader.includes('50/50 rule'), true, 'grader tags the 50/50-rule Push in Notes');

// ---- 3. Tennis/WTA label standardization in model-facing instructions ----
eq(src.includes("Tennis = men's ATP only"), true, '[PICK] format states Tennis is men\'s ATP only');
eq(src.includes("always log women's matches as WTA"), true, '[PICK] format requires WTA for women\'s matches');
const wtaRuleCount = (src.match(/use for ALL women's matches/g) || []).length;
eq(wtaRuleCount >= 2, true, 'both tool league enums carry the WTA-for-all-women\'s-matches rule (found ' + wtaRuleCount + ')');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
