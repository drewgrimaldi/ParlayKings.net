// Tennis odds key ordering (2026-10-16): main tour first, same 4 calls.
//
// The tennis odds branch fetches at most 4 active tournament lists per
// lookup. In raw Odds API catalog order, sub-tour lists (Challenger,
// WTA 125) occupied those slots, so main-tour lines never arrived and
// tennis picks stored no market line (0 of 23 on 2026-10-16). The keys
// are now sorted main-tour-first — the same name test the slate's
// main-tour filter uses — before the SAME slice(0, 4): identical call
// count, zero added quota. Tests the REAL bundle functions by
// extracting them from ../src/index.js (never a copy). Plain node.
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

for (const fn of ['isMainTourTennisOddsKey', 'orderTennisOddsKeys']) {
  eval(extract(fn));
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) { pass++; console.log('ok: ' + msg); }
  else { fail++; console.log('FAIL: ' + msg + ' (got ' + x + ', want ' + y + ')'); }
}

(function () {
  // Classification: sub-tour keys name themselves, exactly as the
  // slate's main-tour signature builder reads them.
  eq(isMainTourTennisOddsKey('tennis_atp_shanghai_masters'), true, 'ATP main-tour key is main tour');
  eq(isMainTourTennisOddsKey('tennis_wta_ningbo_open'), true, 'WTA main-tour key is main tour');
  eq(isMainTourTennisOddsKey('tennis_atp_challenger_cleveland'), false, 'Challenger key is sub-tour');
  eq(isMainTourTennisOddsKey('tennis_wta_125_makarska'), false, '_125 key is sub-tour');
  eq(isMainTourTennisOddsKey('tennis_wta_samsun.125'), false, '.125 key is sub-tour');

  // The crowded-week case that starved the fetch: sub-tour keys first
  // in catalog order. After ordering, the 4-list window is all main
  // tour, in its original relative order.
  const catalog = [
    'tennis_atp_challenger_rovereto',
    'tennis_wta_125_angers',
    'tennis_atp_shanghai_masters',
    'tennis_atp_challenger_valencia',
    'tennis_wta_ningbo_open',
    'tennis_atp_stockholm_open',
    'tennis_wta_guangzhou_open',
  ];
  const ordered = orderTennisOddsKeys(catalog);
  eq(ordered.slice(0, 4), [
    'tennis_atp_shanghai_masters',
    'tennis_wta_ningbo_open',
    'tennis_atp_stockholm_open',
    'tennis_wta_guangzhou_open',
  ], 'first four after ordering are the main-tour lists, catalog order kept');
  eq(ordered.slice(4), [
    'tennis_atp_challenger_rovereto',
    'tennis_wta_125_angers',
    'tennis_atp_challenger_valencia',
  ], 'sub-tour lists keep their relative order after the main tour');

  // Fewer main-tour lists than slots: sub-tour fills the remainder,
  // exactly as before — ordering never removes a key.
  eq(orderTennisOddsKeys(['tennis_atp_challenger_x', 'tennis_wta_tokyo_open']),
    ['tennis_wta_tokyo_open', 'tennis_atp_challenger_x'], 'short catalog: main first, nothing dropped');
  eq(orderTennisOddsKeys([]), [], 'empty in, empty out');
  eq(orderTennisOddsKeys(null), [], 'null in, empty out');

  // Wiring: the odds fetch orders before the same 4-list cut, and the
  // cut itself is unchanged.
  eq(src.includes('orderTennisOddsKeys(allSports.filter'), true, 'odds fetch orders the tennis keys');
  eq(src.includes(')).slice(0, 4) : [];'), true, 'the 4-list cut is unchanged');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
