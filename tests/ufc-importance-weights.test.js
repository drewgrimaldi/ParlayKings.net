// UFC 15-factor importance weights: full wiring test (Drew's call 2026-09-24).
// Covers: every weight key wired into the composite, FightMatrix factors neutral
// until the feed lands, the missing-SApM phantom fix, single-factor isolation,
// the ufcstats.com fight-detail parsers (knockdown rate, control-time
// differential, round-by-round performance, trajectory) on fixture HTML, and
// 3/5-round sim behavior with 0.40 shrinkage intact.
// Tests the REAL bundle code by extracting from ../src/index.js (never a copy).
// Runs under plain node, no dependencies.
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

function extractVar(name) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start < 0) throw new Error('var missing from bundle: ' + name);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

// Bundler name-helpers referenced inside extracted functions — stub as identity.
for (const n of ['__name','__name2','__name22','__name222','__name2222',
  '__name22222','__name222222','__name2222222','__name22222222',
  '__name222222222','__name2222222222','__name22222222222','__name222222222222']) {
  eval('var ' + n + ' = function (f) { return f; };');
}
eval(extractVar('UFC_WEIGHT_CLASS_SCALE'));
eval(extractVar('UFC_IMPORTANCE_WEIGHTS'));
eval(extractVar('UFC_ROUND_EDGE_SCALE'));
eval(extractVar('CONSERVATISM_SHRINKAGE'));
for (const fn of ['sampleNormal', 'ufcNum', 'ufcClampEdge', 'ufcFinishRate',
  'ufcHeightInches', 'ufcReachInches', 'ufcStanceType', 'ufcWeightClassScale',
  'ufcCountryKey', 'ufcSameCountry', 'ufcPhysicalNetEdge', 'ufcFinishMixScale',
  'ufcWeightClassFinishBias', 'ufcLastFiveTiebreak', 'ufcWeightedCompositeEdge',
  'runUFCMultiStatSimulation', 'matchName', 'stripDiacritics',
  'parseUfcStatsFightHistoryUrls', 'parseUfcStatsFightRounds', 'computeUfcDeepBundle']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'));
}
function checkClose(desc, actual, expected, eps) {
  const ok = Math.abs(actual - expected) <= (eps || 1e-9);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
}
function checkBetween(desc, actual, lo, hi) {
  const ok = actual > lo && actual < hi;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' => ' + actual + (ok ? '' : ' (expected between ' + lo + ' and ' + hi + ')'));
}

function baseFighter(over) {
  return Object.assign({
    strikeLPM: 4.5, strikeAccuracy: 46, takedownAvg: 1.2, takedownAccuracy: 40,
    submissionAvg: 0.3, sapm: 4.0, strikeDefense: 54, takedownDefense: 60,
    reach: 72, height: 70, stance: 'orthodox', age: 29,
    weightClass: 'Lightweight', country: 'United States', finishMix: null,
    recent: null, deep: null
  }, over);
}
const edgeOf = (a, b) => ufcWeightedCompositeEdge(a, b, null);

// ---------- (a) all 15 keys wired into the composite ----------
const full = edgeOf(baseFighter(), baseFighter());
const missing = UFC_IMPORTANCE_WEIGHTS.filter((f) => !(f.key in full.edges));
check('all 15 weight keys present in composite edges', missing.length, 0);
checkClose('symmetric fighters -> E exactly 0', full.E, 0);

// ---------- (b) FightMatrix factors neutral until the feed lands ----------
check('competition neutral without FightMatrix feed', full.edges.competition, 0);

// ---------- (c) missing-SApM phantom fix ----------
// Note: SApM is no longer a standalone factor in Drew's 2026-10-05 weights.
// Strike differential still goes neutral when SApM is missing.
const noSapm = edgeOf(baseFighter({ sapm: undefined }), baseFighter({ sapm: undefined }));
check('no phantom strike-differential when both SApM missing', noSapm.edges.strikeDiff, 0);
const oneSapm = edgeOf(baseFighter({ sapm: undefined }), baseFighter({ sapm: 4.0 }));
check('no phantom strike-differential when one side SApM missing', oneSapm.edges.strikeDiff, 0);
checkClose('one-sided missing SApM -> composite edge exactly 0', oneSapm.E, 0);
const simNoSapm = runUFCMultiStatSimulation(
  baseFighter({ sapm: undefined }), baseFighter({ sapm: undefined }), 20000, 3, null);
check('sim 50/50 with no SApM on either side', simNoSapm.winPctA, 50);

// ---------- (d) single-factor isolation: strikeDiff ----------
// Drew's 2026-10-05 weights: strikeDiff 0.15, SApM factor removed.
const iso = edgeOf(baseFighter({ strikeLPM: 7.5, sapm: 1.0 }), baseFighter({ strikeLPM: 4.5, sapm: 4.0 }));
// strikeDiff edge clamps to 1 (0.15)
checkClose('isolated strike-diff E = 0.15*1', iso.E, 0.15);

// ---------- (e) deep parsers on fixture ufcstats.com Totals-table HTML ----------
function fightRow(name, round, kd, sig, ctrl) {
  return '<tr class="b-fight-details__table-row">' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text"><a class="b-link" href="#">' + name + '</a></p><p class="b-fight-details__table-text">Round ' + round + '</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">' + kd + '</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">' + sig + ' of 50</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">50%</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">' + sig + ' of 55</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">1 of 2</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">50%</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">0</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">0</p></td>' +
    '<td class="b-fight-details__table-col"><p class="b-fight-details__table-text">' + ctrl + '</p></td></tr>';
}
function totalsTable(rows) {
  return '<table><thead><tr><th>Fighter</th><th>KD</th><th>Sig str</th><th>Sig str %</th><th>Total str</th><th>TD</th><th>TD %</th><th>Sub att</th><th>Rev</th><th>Ctrl</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
// Fight 1 (most recent): Alex dominates both rounds, 1 KD in round 1.
const fight1 = totalsTable(
  fightRow('Alex Hunter', 1, 1, 28, '2:15') + fightRow('Bob Striker', 1, 0, 12, '0:45') +
  fightRow('Alex Hunter', 2, 0, 30, '1:00') + fightRow('Bob Striker', 2, 0, 10, '0:30'));
// Fight 2: Alex dominates both rounds, no KDs.
const fight2 = totalsTable(
  fightRow('Alex Hunter', 1, 0, 30, '1:00') + fightRow('Bob Striker', 1, 0, 10, '0:30') +
  fightRow('Alex Hunter', 2, 0, 25, '1:30') + fightRow('Bob Striker', 2, 0, 15, '0:20'));
// Fight 3: Alex loses both rounds, 1 KD in round 1.
const fight3 = totalsTable(
  fightRow('Alex Hunter', 1, 1, 10, '0:20') + fightRow('Bob Striker', 1, 0, 30, '1:00') +
  fightRow('Alex Hunter', 2, 0, 12, '0:30') + fightRow('Bob Striker', 2, 0, 25, '1:30'));

const r1 = parseUfcStatsFightRounds(fight1, 'Alex Hunter');
check('fight1 parses 2 rounds', r1 && r1.length, 2);
check('round 1 KD parsed', r1[0].kd, 1);
check('round 1 sig strikes parsed', r1[0].sigStr, 28);
check('round 1 control seconds parsed', r1[0].ctrlSec, 135);
check('round 1 opponent sig strikes parsed', r1[0].oppSigStr, 12);
check('round 1 opponent control parsed', r1[0].oppCtrlSec, 45);
check('round 2 KD parsed', r1[1].kd, 0);

const bundle = computeUfcDeepBundle([
  parseUfcStatsFightRounds(fight1, 'Alex Hunter'),
  parseUfcStatsFightRounds(fight2, 'Alex Hunter'),
  parseUfcStatsFightRounds(fight3, 'Alex Hunter'),
]);
checkClose('knockdown rate = 2 KD / 30 min * 15', bundle.kdRate, 1.0);
checkClose('control-time differential = 120s / 6 rounds', bundle.ctrlDiffSec, 20);
checkClose('round win pct = 4/6', bundle.roundWinPct, 4 / 6);
checkClose('trajectory = recent 1.0 - older avg 0.5', bundle.trajectory, 0.5);
check('3 fights counted', bundle.fights, 3);

// deep bundle flows into the composite: knockdownRate / cardio / controlTime
const withDeep = edgeOf(
  baseFighter({ deep: bundle }),
  baseFighter({ deep: { kdRate: 0, ctrlDiffSec: -20, roundWinPct: 1 / 3, trajectory: -0.5, fights: 3 } }));
check('knockdown edge maxes with real deep data', withDeep.edges.knockdownRate > 0.9, true);
check('cardio edge moves with real deep data', withDeep.edges.cardio > 0, true);

// ---------- (f) fight-history URL extraction ----------
const fighterPage = '<a href="https://ufcstats.com/fight-details/abc123">x</a>' +
  '<a href="https://ufcstats.com/fight-details/def456">x</a>' +
  '<a href="https://ufcstats.com/fight-details/abc123">x</a>' +
  '<a href="https://ufcstats.com/fight-details/7890ab">x</a>';
const urls = parseUfcStatsFightHistoryUrls(fighterPage);
check('extracts 3 unique fight URLs, most-recent-first', JSON.stringify(urls),
  JSON.stringify(['https://ufcstats.com/fight-details/abc123', 'https://ufcstats.com/fight-details/def456', 'https://ufcstats.com/fight-details/7890ab']));

// ---------- (g) sim behavior: 3 and 5 rounds, shrinkage intact ----------
const sym3 = runUFCMultiStatSimulation(baseFighter(), baseFighter(), 20000, 3, null);
check('3-round symmetric -> 50/50', sym3.winPctA, 50);
const sym5 = runUFCMultiStatSimulation(baseFighter(), baseFighter(), 20000, 5, null);
check('5-round symmetric -> 50/50', sym5.winPctA, 50);
check('shrinkage is 0.40', CONSERVATISM_SHRINKAGE, 0.40);
check('round edge scale 0.75', UFC_ROUND_EDGE_SCALE, 0.75);

if (fails) { console.log(fails + ' tests failed'); process.exit(1); }
console.log('all ufc importance weights tests passed');
