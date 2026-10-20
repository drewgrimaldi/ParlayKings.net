// UFC result write-ups: until 2026-10-17 the recap builder had no UFC
// branch, so every graded fight shipped the bare "Winner: X." fallback
// while ESPN's card data carried the method, round, and finish time.
// ufcFinishLineFromComp composes the factual finish line; when ESPN's
// result tag is absent and the fight ended early, NO method is claimed.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.log('FAIL:', name); } };
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}
const ufcFinishLineFromComp = eval('(' + extractFn('ufcFinishLineFromComp') + ')');
const comp = (over) => Object.assign({
  status: { period: 3, displayClock: '4:19', clock: 259, type: { state: 'post' } },
  format: { regulation: { periods: 3 } },
  details: [{ type: { text: 'Fight Over' } }],
  competitors: [
    { athlete: { displayName: 'Cody Chovancek' }, winner: false },
    { athlete: { displayName: 'SuYoung You' }, winner: true }
  ]
}, over || {});
check('submission tag composes method + round + time',
  ufcFinishLineFromComp(comp({ details: [{ type: { text: 'Unofficial Winner Submission' } }] })) ===
  'SuYoung You def. Cody Chovancek by submission at 4:19 of Round 3.');
check('KO tag lowercases into the sentence',
  ufcFinishLineFromComp(comp({ details: [{ type: { text: 'Unofficial Winner KO/TKO' } }] })).includes('by ko/tko at 4:19 of Round 3.'));
check('final bell with no tag reads as a decision',
  ufcFinishLineFromComp(comp({ status: { period: 3, displayClock: '5:00', clock: 300, type: { state: 'post' } } })) ===
  'SuYoung You def. Cody Chovancek by decision after 3 rounds.');
check('decision tag reads as a decision',
  ufcFinishLineFromComp(comp({ details: [{ type: { text: 'Unofficial Winner Decision' } }] })).includes('by decision after 3 rounds.'));
check('early finish with no tag claims NO method',
  ufcFinishLineFromComp(comp({})) === 'SuYoung You def. Cody Chovancek \u2014 the finish came at 4:19 of Round 3.');
check('five-round title fight distance uses 5 rounds',
  ufcFinishLineFromComp(comp({ format: { regulation: { periods: 5 } }, status: { period: 5, displayClock: '5:00', clock: 300, type: { state: 'post' } } })).includes('after 5 rounds.'));
check('not final returns empty', ufcFinishLineFromComp(comp({ status: { period: 1, displayClock: '2:00', clock: 120, type: { state: 'in' } } })) === '');
check('missing winner returns empty', ufcFinishLineFromComp(comp({ competitors: [{ athlete: { displayName: 'A' } }, { athlete: { displayName: 'B' } }] })) === '');
check('builder + sweep + wiring present in source',
  src.includes('async function ufcRecapLines') && src.includes('gradeKey === "UFC") return await ufcRecapLines') && src.includes('async function repairBareUfcWriteups') && src.includes('await repairBareUfcWriteups(env, url)'));
console.log(`ufc-result-writeup: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
