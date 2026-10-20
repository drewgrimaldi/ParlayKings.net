// Wiring-audit build (2026-09-23): the 5 clean targets.
// (1) soccer star resolves per-team in its own competition
// (3) NHL goalie save% sample gate (games fetched, previously dropped)
// (4) NFL passYpg / rushYpg / yardsPerGame / fourthDownPct now read by
//     footballProfileToFactor
// (2) venue-split trace note and (5) dead-code cleanup are structural;
//     covered by node --check + full suite, not unit tests.
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

function extractConst(name) {
  // const/let do not leak out of eval, so pull the real literal value from the
  // bundle and publish it on globalThis for the extracted functions to read.
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('const missing from bundle: ' + name);
  globalThis[name] = eval('(' + m[1] + ')');
}

// footballProfileToFactor wraps its bit-applier in the bundler's __name2222;
// stub every __name variant as identity so extracted code runs standalone.
for (let n = 0; n <= 12; n++) {
  globalThis['__name' + '2'.repeat(n)] = (fn) => fn;
}

for (const v of ['SOCCER_STAR_MIN_MATCHES', 'SOCCER_STAR_LEAGUE_AVG_GPG',
  'SOCCER_STAR_SCALE_DIVISOR', 'NHL_GOALIE_MIN_GAMES',
  'NHL_GOALIE_FULL_SAMPLE_GAMES', 'NHL_GOALIE_LEAGUE_AVG_SV']) {
  extractConst(v);
}

for (const fn of ['stripDiacritics', 'matchName', 'soccerScorerToStar',
  'resolveSoccerStarsByCompetition', 'nhlGoalieEffSavePct',
  'nhlGoalieFactorFromSavePct', 'normalizeLeague', 'footballLeagueAverages',
  'footballProfileToFactor']) {
  eval(extract(fn));
}

let fails = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' | got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}
function checkClose(desc, actual, expected, eps) {
  const ok = Math.abs(actual - expected) <= eps;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + desc + ' | got=' + actual + ' want~' + expected);
}
function checkTrue(desc, cond) {
  if (!cond) fails++;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + desc);
}

// ---------- (1) soccer star per-competition resolution ----------
const qA = matchName('Arsenal');
const qB = matchName('Real Madrid');
const plScorers = [
  { team: { name: 'Arsenal', shortName: 'ARS', tla: 'ARS' }, player: { name: 'Bukayo Saka' }, goals: 8, playedMatches: 6 },
  { team: { name: 'Manchester City', shortName: 'MCI', tla: 'MCI' }, player: { name: 'Erling Haaland' }, goals: 12, playedMatches: 6 }
];
const pdScorers = [
  { team: { name: 'Real Madrid', shortName: 'RMA', tla: 'RMA' }, player: { name: 'Kylian Mbappe' }, goals: 10, playedMatches: 6 },
  { team: { name: 'Barcelona', shortName: 'BAR', tla: 'BAR' }, player: { name: 'Robert Lewandowski' }, goals: 9, playedMatches: 6 }
];
// The old bug: loop returned at PL with starB null because Real Madrid has no
// scorer in England. New code must keep going and find Mbappe in PD.
const split = resolveSoccerStarsByCompetition(
  [{ code: 'PL', scorers: plScorers }, { code: 'PD', scorers: pdScorers }], qA, qB);
check('starA resolves in PL', split.starA && split.starA.name, 'Bukayo Saka');
check('starB resolves in PD (not dropped)', split.starB && split.starB.name, 'Kylian Mbappe');
check('competitionA is PL', split.competitionA, 'PL');
check('competitionB is PD', split.competitionB, 'PD');
// Both teams in the same competition still resolve together.
const same = resolveSoccerStarsByCompetition(
  [{ code: 'PL', scorers: plScorers }], matchName('Arsenal'), matchName('Manchester City'));
check('same-comp starA', same.starA && same.starA.name, 'Bukayo Saka');
check('same-comp starB', same.starB && same.starB.name, 'Erling Haaland');
// Nobody anywhere -> null (fail-open preserved).
check('no scorers anywhere -> null',
  resolveSoccerStarsByCompetition([{ code: 'PL', scorers: [] }], qA, qB), null);

// ---------- (3) NHL goalie sample gate ----------
// 2-game .960 call-up: SV% not usable (old code: 1-(0.960-0.905)/0.1 = 0.45 ->
// clamped 0.8, max suppression from 2 games of noise).
check('2-game .960 -> eff null (not used)', nhlGoalieEffSavePct(0.960, 2), null);
check('0 games -> eff null', nhlGoalieEffSavePct(0.930, 0), null);
check('missing games -> eff null', nhlGoalieEffSavePct(0.930, undefined), null);
// 30-game .920 workhorse: full weight, still counts.
checkClose('30-game .920 -> eff .920 (full weight)', nhlGoalieEffSavePct(0.920, 30), 0.920, 1e-9);
checkClose('30-game .920 -> factor 0.85 (counts)', nhlGoalieFactorFromSavePct(nhlGoalieEffSavePct(0.920, 30)), 0.85, 1e-9);
// Partial sample shrinks toward .905: 5-game .960 -> w=0.5 -> eff .9325.
checkClose('5-game .960 -> eff .9325 (shrunk)', nhlGoalieEffSavePct(0.960, 5), 0.9325, 1e-9);
// Boundary: exactly 3 games is usable.
checkTrue('3 games is usable (not null)', nhlGoalieEffSavePct(0.910, 3) !== null);
check('bad save% still null', nhlGoalieEffSavePct(null, 30), null);

// ---------- (4) NFL newly-wired stats move the factor the right way ----------
// NOTE (2026-09-23, FOOTBALL TIERED HIERARCHY): passYpa/passYpg/yardsPerGame
// were REMOVED from the efficiency factor — the QB's passing influence now
// flows only through the tier-1 QB factor (single dominant weight, no triple
// count). rushYpg and fourthDownPct remain tier-5 efficiency bits.
const base = { gamesPlayed: 8, passYpa: 7.0, rushYpc: 4.3, ppg: 24 };
const fBase = footballProfileToFactor(base, null, 'NFL', 8).factor;
// passYpg no longer lifts the efficiency factor (QB consolidation).
const fPassUp = footballProfileToFactor({ ...base, passYpg: 280 }, null, 'NFL', 8);
checkTrue('passYpg 280 does NOT lift efficiency factor (QB consolidation)', fPassUp.factor === fBase);
checkTrue('no pass bits in efficiency (QB consolidation)', !fPassUp.bits.some((b) => b.startsWith('pass ')));
// rushYpg well below the 117 average drags it down.
const fRushDown = footballProfileToFactor({ ...base, rushYpg: 70 }, null, 'NFL', 8);
checkTrue('rushYpg 70 < avg lowers factor', fRushDown.factor < fBase);
// fourthDownPct above the 52 anchor lifts it.
const f4th = footballProfileToFactor({ ...base, fourthDownPct: 70 }, null, 'NFL', 8);
checkTrue('4thD 70% > avg lifts factor', f4th.factor > fBase);
// yardsPerGame no longer applies at all (QB consolidation — was a fallback).
const fYpgGone = footballProfileToFactor({ gamesPlayed: 8, yardsPerGame: 420 }, null, 'NFL', 8);
checkTrue('YPG bit gone entirely (QB consolidation)', !fYpgGone.bits.some((b) => b.startsWith('YPG')));
checkTrue('YPG 420 does NOT lift factor (QB consolidation)',
  fYpgGone.factor === footballProfileToFactor({ gamesPlayed: 8 }, null, 'NFL', 8).factor);
// CFB anchors differ (ypg 390 / passYpg 245 / rushYpg 145 / 4thD 48).
const cAvg = footballLeagueAverages('CFB');
check('CFB ypg anchor', cAvg.ypg, 390);
check('CFB passYpg anchor', cAvg.passYpg, 245);
check('CFB rushYpg anchor', cAvg.rushYpg, 145);
check('CFB fourthPct anchor', cAvg.fourthPct, 48);
const nAvg = footballLeagueAverages('NFL');
check('NFL passYpg anchor', nAvg.passYpg, 218);
check('NFL rushYpg anchor', nAvg.rushYpg, 117);

if (fails) { console.error(fails + ' FAILURES'); process.exit(1); }
console.log('ALL WIRING-AUDIT-3 CHECKS PASSED');
