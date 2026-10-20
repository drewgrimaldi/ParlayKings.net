// Tennis 50/50 stand RETIRED (2026-10-16): dead-even tennis decides.
//
// Until this change, a genuinely even tennis sim (model calls 50/50, or
// the split lands within 2 points) could be logged as an honest "50/50"
// coin flip (winner literally "50/50", grades Push), capped at 3 a day.
// That stand is retired: the pick now flows through the same lock +
// force-side path as every other league — a model-declared 50/50
// resolves to the higher sim side (first-listed on an exact tie) and an
// even split is forced to 51% for that side, so the pick logs with a
// real winner. Historical 50/50 records still grade Push (grader rule,
// untouched). Tests the REAL bundle functions by extracting them from
// ../src/index.js (never a copy). Runs under plain node, no deps.
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

for (const v of ['var TENNIS_FIFTYFIFTY_DAILY_CAP', 'var TENNIS_FIFTYFIFTY_CLOSE_MARGIN']) {
  const s = src.indexOf(v);
  if (s < 0) throw new Error('bundle constant missing: ' + v);
  eval(src.slice(s, src.indexOf(';', s) + 1));
}
for (const fn of ['normalizeLeague', 'isTennisPickLeague', 'isFiftyFiftyWinner',
  'matchupSideNames', 'isTennisFiftyFiftyCandidate',
  'applyTennisFiftyFiftyLock', 'forceNonTennisSide']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

// The handler's post-sim pipeline for a pick that reaches logging:
// lock (resolves a declared 50/50 to the higher sim side), then
// force-side (an even confidence is lifted to 51% for the higher side).
function decide(pick, sim, text) {
  const locked = applyTennisFiftyFiftyLock(pick, sim, text || 'analysis');
  forceNonTennisSide(locked.pick, sim);
  return locked.pick;
}

(function () {
  const simEven = { nameA: 'Alcaraz', winPctA: 50, nameB: 'Sinner', winPctB: 50 };
  const simEdgeB = { nameA: 'Alcaraz', winPctA: 49, nameB: 'Sinner', winPctB: 51 };
  const simEdge = { nameA: 'Alcaraz', winPctA: 51, nameB: 'Sinner', winPctB: 49 };

  // Candidate detection itself is unchanged (the gate function remains).
  eq(isTennisFiftyFiftyCandidate({ league: 'Tennis', winner: '50/50' }, null), true, 'model-written 50/50 is still detected as a candidate');
  eq(isTennisFiftyFiftyCandidate({ league: 'Tennis', winner: 'Alcaraz' }, simEven), true, 'tennis 50/50 sim is still detected as a candidate');
  eq(isTennisFiftyFiftyCandidate({ league: 'Tennis', winner: 'Alcaraz' }, { nameA: 'Alcaraz', winPctA: 60, nameB: 'Sinner', winPctB: 40 }), false, 'tennis 60/40 sim is not a candidate');

  // Model-declared 50/50 on an exact tie: resolves to the first-listed
  // side and logs at 51% — a real pick, not a coin-flip record.
  const tie = decide({ league: 'WTA', winner: '50/50', confidence: 50, matchup: 'Alcaraz vs Sinner' }, simEven);
  eq(tie.winner, 'Alcaraz', 'declared 50/50 on an exact tie resolves to the first-listed side');
  eq(tie.confidence, 51, 'exact tie logs at 51%');
  eq(isFiftyFiftyWinner(tie.winner), false, 'logged winner is a real name, not 50/50');

  // Model-declared 50/50 with a higher side: resolves to that side at
  // its real sim number.
  const edgeB = decide({ league: 'Tennis', winner: '50/50', confidence: 50, matchup: 'Alcaraz vs Sinner' }, simEdgeB);
  eq(edgeB.winner, 'Sinner', 'declared 50/50 resolves to the higher sim side');
  eq(edgeB.confidence, 51, 'higher side keeps its sim number (51)');

  // Named winner on an exactly even sim: forced to the higher sim side
  // (first-listed on a tie) at 51%, like every other league.
  const named = decide({ league: 'Tennis', winner: 'Sinner', confidence: 50, matchup: 'Alcaraz vs Sinner' }, simEven);
  eq(named.winner, 'Alcaraz', 'named pick on an even sim is forced to the first-listed side');
  eq(named.confidence, 51, 'even sim logs at 51%');

  // A side already chosen at a real number is the model's decision and
  // stands untouched.
  const chosen = decide({ league: 'WTA', winner: 'Alcaraz', confidence: 51, matchup: 'Alcaraz vs Sinner' }, simEdge);
  eq(chosen.winner, 'Alcaraz', 'chosen side at 51 stands');
  eq(chosen.confidence, 51, 'chosen confidence stands');

  // Wiring: the handler no longer stands a coin flip or touches the
  // daily counter; the lock + force path is what every pick flows
  // through.
  eq(src.includes('applyTennisFiftyFiftyStand(pick, sim, cleanText)'), false, 'handler no longer calls the 50/50 stand');
  eq(src.includes('await flipKv.put(flipKey'), false, 'handler no longer writes the tennis5050 counter');
  eq(src.includes('tennisFiftyFiftyDecision(flipUsed'), false, 'handler no longer consults the stand cap');
  eq(src.includes('applyTennisFiftyFiftyLock(pick, sim, cleanText)'), true, 'handler still runs the fifty-fifty lock');
  eq(src.includes('forceNonTennisSide(pick, sim)'), true, 'handler still runs force-side');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
