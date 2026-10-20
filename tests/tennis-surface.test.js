// Tennis surface: detection from tournament names + heavy first-class weighting
// in the hold math. Tests the REAL bundle functions by extracting them from
// ../src/index.js (never a copy). Runs under plain node, no dependencies.
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

for (const fn of ['tennisSurfaceFromTournamentName', 'tennisServeHoldProb']) {
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

// ---------- (a) surface detection from tournament names ----------
check('Australian Open -> hard', tennisSurfaceFromTournamentName('Australian Open'), 'hard');
check('Roland-Garros -> clay', tennisSurfaceFromTournamentName('Roland-Garros'), 'clay');
check('Roland Garros (space) -> clay', tennisSurfaceFromTournamentName('Roland Garros'), 'clay');
check('French Open -> clay', tennisSurfaceFromTournamentName('French Open'), 'clay');
check('Wimbledon -> grass', tennisSurfaceFromTournamentName('Wimbledon'), 'grass');
check('US Open -> hard', tennisSurfaceFromTournamentName('US Open'), 'hard');
check('U.S. Open -> hard', tennisSurfaceFromTournamentName('U.S. Open'), 'hard');
check('non-Slam (Chengdu Open) -> null (no guessing)', tennisSurfaceFromTournamentName('Chengdu Open'), null);
check('empty string -> null', tennisSurfaceFromTournamentName(''), null);
check('null -> null', tennisSurfaceFromTournamentName(null), null);

// ---------- (b) surface moves hold probability, heavy and directional ----------
const base = { actualHoldPct: 0.8, usedSurfaceHold: false, rank: undefined, winPct: undefined, surfaceWinPct: undefined, surfaceMatches: undefined, indoor: false, recentWinPct: undefined, h2hEdge: undefined, weatherAdj: undefined };

checkClose('grass raises hold +0.04', tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'grass' })), 0.84);
checkClose('hard is neutral', tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'hard' })), 0.80);
checkClose('clay lowers hold -0.04', tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'clay' })), 0.76);
checkClose('unknown surface stays neutral', tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: null })), 0.80);

// No double-counting: surface-specific hold tape already IS the surface effect.
checkClose('surface tape + grass => no modifier', tennisServeHoldProb(Object.assign({}, base, { usedSurfaceHold: true, surfaceGroup: 'grass' })), 0.80);
checkClose('surface tape + clay => no modifier', tennisServeHoldProb(Object.assign({}, base, { usedSurfaceHold: true, surfaceGroup: 'clay' })), 0.80);

// Player's own surface W-L edge (real observed data, 5+ matches) gets weight.
checkClose('surface W-L edge: 70% on surface vs 50% overall, 10 matches, hard',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'hard', surfaceWinPct: 70, winPct: 50, surfaceMatches: 10 })), 0.83);
checkClose('surface W-L edge ignored below 5 matches',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'hard', surfaceWinPct: 70, winPct: 50, surfaceMatches: 3 })), 0.80);
checkClose('surface W-L edge ignored with surface-specific tape',
  tennisServeHoldProb(Object.assign({}, base, { usedSurfaceHold: true, surfaceGroup: 'hard', surfaceWinPct: 70, winPct: 50, surfaceMatches: 10 })), 0.80);
checkClose('surface W-L edge: negative edge lowers hold',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'hard', surfaceWinPct: 40, winPct: 60, surfaceMatches: 12 })), 0.77);
checkClose('surface W-L delta capped at +/-25pp',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'hard', surfaceWinPct: 100, winPct: 50, surfaceMatches: 10 })), 0.8375);

// Total surface budget clamped at +/-0.06 (grass +0.04 + max edge 0.0375 = 0.0775 -> 0.06).
checkClose('total surface contribution clamped to +0.06',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'grass', surfaceWinPct: 100, winPct: 50, surfaceMatches: 10 })), 0.86);
checkClose('total surface contribution clamped to -0.06',
  tennisServeHoldProb(Object.assign({}, base, { surfaceGroup: 'clay', surfaceWinPct: 20, winPct: 70, surfaceMatches: 10 })), 0.74);

// Overall hold clamp still holds.
checkClose('hold never exceeds 0.94',
  tennisServeHoldProb(Object.assign({}, base, { actualHoldPct: 0.93, surfaceGroup: 'grass', surfaceWinPct: 90, winPct: 50, surfaceMatches: 20 })), 0.94);

console.log(fails === 0 ? '\nALL TENNIS-SURFACE TESTS PASSED' : '\n' + fails + ' TENNIS-SURFACE TESTS FAILED');
process.exit(fails === 0 ? 0 : 1);
