// NBA 12-factor weighted composite (Drew's call 2026-10-05).
// Tests the REAL bundle functions extracted from ../src/index.js (never a copy).
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

// Pull the weights array and helper functions.
// Note: eval'd const doesn't leak to outer scope, so we capture via Function.
const weightsSrc = src.match(/const NBA_IMPORTANCE_WEIGHTS = \[[\s\S]*?\];/)[0];
const weightsTotalSrc = extract('nbaWeightsTotal');
const normalizeSrc = extract('normalizeLeague');
const leagueAvgSrc = extract('basketballLeagueAverages');
const compositeSrc = extract('nbaWeightedCompositeEdge');
const setupFn = new Function(weightsSrc + '\n' + weightsTotalSrc + '\n' + normalizeSrc + '\n' + leagueAvgSrc + '\n' + compositeSrc + '\n' +
  'return { NBA_IMPORTANCE_WEIGHTS, nbaWeightsTotal, basketballLeagueAverages, nbaWeightedCompositeEdge };');
const { NBA_IMPORTANCE_WEIGHTS, nbaWeightsTotal, basketballLeagueAverages, nbaWeightedCompositeEdge } = setupFn();

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', name); }
}

// 1. Weights sum to 100%.
check('weights sum to 1.0', Math.abs(nbaWeightsTotal() - 1.0) < 1e-9);

// 2. 12 factors.
check('12 factors', NBA_IMPORTANCE_WEIGHTS.length === 12);

// 3. Net Rating is 20%, the highest weight.
const netRtg = NBA_IMPORTANCE_WEIGHTS.find(w => w.key === 'netRtg');
check('netRtg weight is 0.20', netRtg && netRtg.weight === 0.20);

// 4. All Drew's weights match.
const expected = {
  netRtg: 0.20, efg: 0.15, tovPct: 0.12, orebPct: 0.10,
  ftRate: 0.08, threePct: 0.08, pace: 0.06, recentForm: 0.06,
  injuries: 0.05, homeCourt: 0.04, rest: 0.03, matchup: 0.03,
};
for (const [key, weight] of Object.entries(expected)) {
  const w = NBA_IMPORTANCE_WEIGHTS.find(x => x.key === key);
  check(`weight ${key} = ${weight}`, w && w.weight === weight);
}

// 5. Composite returns zero edge with missing profiles.
const empty = nbaWeightedCompositeEdge({ teamA: 'A', teamB: 'B', statsA: {}, statsB: {}, league: 'NBA' });
check('missing profiles -> zero edge', empty.edge === 0 && empty.bits.length === 0);

// 6. Composite with real-ish profiles produces a non-zero edge.
const statsA = {
  offense: 115, defense: 110, gamesPlayed: 10,
  basketballProfile: {
    gamesPlayed: 10, efg: 56, tovPct: 12, oreb: 25, dreb: 70,
    ftRate: 0.28, threePct: 38, pace: 102, tpm: 12, fgm: 40, pts: 115,
  },
};
const statsB = {
  offense: 110, defense: 112, gamesPlayed: 10,
  basketballProfile: {
    gamesPlayed: 10, efg: 53, tovPct: 14, oreb: 22, dreb: 68,
    ftRate: 0.24, threePct: 35, pace: 98, tpm: 10, fgm: 38, pts: 110,
  },
};
const result = nbaWeightedCompositeEdge({
  teamA: 'Lakers', teamB: 'Celtics',
  statsA, statsB,
  ctxA: { isHome: true, restDays: 2 },
  ctxB: { isHome: false, restDays: 1 },
  league: 'NBA',
});
check('better team gets positive edge', result.edge > 0);
check('bits are populated', result.bits.length > 0);

// 7. Symmetry: swapping teams flips the edge sign.
const flipped = nbaWeightedCompositeEdge({
  teamA: 'Celtics', teamB: 'Lakers',
  statsA: statsB, statsB: statsA,
  ctxA: { isHome: false, restDays: 1 },
  ctxB: { isHome: true, restDays: 2 },
  league: 'NBA',
});
check('symmetry: flipped edge', Math.abs(result.edge + flipped.edge) < 1e-9);

// 8. Home court adds edge.
const noHome = nbaWeightedCompositeEdge({
  teamA: 'Lakers', teamB: 'Celtics',
  statsA, statsB,
  ctxA: { isHome: false, restDays: 2 },
  ctxB: { isHome: false, restDays: 2 },
  league: 'NBA',
});
check('home court adds edge', result.edge > noHome.edge);

// 9. CBB uses +4 home court (vs NBA +3).
const cbbHome = nbaWeightedCompositeEdge({
  teamA: 'Duke', teamB: 'UNC',
  statsA, statsB,
  ctxA: { isHome: true, restDays: 2 },
  ctxB: { isHome: false, restDays: 2 },
  league: 'CBB',
});
const nbaHome = nbaWeightedCompositeEdge({
  teamA: 'Lakers', teamB: 'Celtics',
  statsA, statsB,
  ctxA: { isHome: true, restDays: 2 },
  ctxB: { isHome: false, restDays: 2 },
  league: 'NBA',
});
// CBB home edge should be larger than NBA home edge (4 vs 3, weighted 4%).
check('CBB home court > NBA home court', cbbHome.edge > nbaHome.edge);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
