// NHL confirmed starting goalie: probableStarter extraction + save% factor math.
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

for (const fn of ['extractNHLProbableGoalie', 'nhlGoalieFactorFromSavePct']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}

// --- Probable goalie extraction (shape mirrors live ESPN NHL scoreboard) ---
const confirmedComp = {
  team: { displayName: 'Ottawa Senators' },
  probables: [{
    name: 'probableStartingGoalie',
    displayName: 'Probable Starting Goalie',
    abbreviation: 'SG',
    playerId: 3069285,
    athlete: { id: '3069285', fullName: 'Linus Ullmark', displayName: 'Linus Ullmark', position: 'G' },
    status: { name: 'Confirmed', type: 'confirmed' }
  }]
};
check('confirmed starter extracts with id/name/confirmed=true',
  extractNHLProbableGoalie(confirmedComp),
  { id: '3069285', name: 'Linus Ullmark', confirmed: true });

const unconfirmedComp = {
  team: { displayName: 'Ottawa Senators' },
  probables: [{
    name: 'probableStartingGoalie',
    abbreviation: 'SG',
    playerId: 123,
    athlete: { id: '123', fullName: 'Some Goalie', position: 'G' },
    status: { name: 'Expected', type: 'expected' }
  }]
};
check('non-confirmed status extracts with confirmed=false',
  extractNHLProbableGoalie(unconfirmedComp),
  { id: '123', name: 'Some Goalie', confirmed: false });

check('empty probables => null', extractNHLProbableGoalie({ probables: [] }), null);
check('missing probables => null', extractNHLProbableGoalie({ team: {} }), null);
check('null competitor => null', extractNHLProbableGoalie(null), null);
check('non-goalie probable ignored', extractNHLProbableGoalie({
  probables: [{ name: 'probablePitcher', athlete: { id: '9', fullName: 'A Pitcher' }, status: { type: 'confirmed' } }]
}), null);

// --- Save% factor math (opponent direction, 0.8-1.25 clamp) ---
check('league-average .905 => 1.0', nhlGoalieFactorFromSavePct(0.905), 1);
check('.915 => 0.9', Math.round(nhlGoalieFactorFromSavePct(0.915) * 10000) / 10000, 0.9);
check('.895 => 1.1', Math.round(nhlGoalieFactorFromSavePct(0.895) * 10000) / 10000, 1.1);
check('elite .930 clamps at 0.8', nhlGoalieFactorFromSavePct(0.93), 0.8);
check('rough .875 clamps at 1.25', nhlGoalieFactorFromSavePct(0.875), 1.25);
check('null => null', nhlGoalieFactorFromSavePct(null), null);
check('non-number => null', nhlGoalieFactorFromSavePct('hot'), null);
check('NaN => null', nhlGoalieFactorFromSavePct(NaN), null);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('All NHL goalie tests passed.');
