// Per-league calibration bias: picked-side application + SYMMETRIC bounds.
// The Supabase league bias is computed from picked-side outcomes (stated
// confidence of the pick vs. actual), so it must be applied to the picked
// side's percentage, not always teamA's (teamA/teamB are just tool-arg order).
// Down-only from the 2026-09-29 restore until 2026-10-13; since 2026-10-13
// the bias is symmetric ([-15, +15]): it shaves a league whose stated numbers
// overshoot its hit rate and raises one whose numbers undershoot it. Stale
// pre-epoch rows are still ignored — by the reader, before this ever runs.
// Tests the real applyCalibrationToResultText() from ../src/index.js (never a
// copy). Runs under plain node, no dependencies.
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

eval(fnBody('escapeRegExp'));
eval(fnBody('applyCalibrationToResultText'));

function simText(a, pctA, b, pctB) {
  return `${a}: ${pctA}% win rate\n${b}: ${pctB}% win rate`;
}
function pctOf(out, team) {
  const m = out.match(new RegExp(escapeRegExp(team) + ': (\\d{1,3})% win rate'));
  return m ? parseInt(m[1], 10) : null;
}

// ---- 1. Picking teamB: bias must hit teamB, not teamA ----
// NFL-style: bias -12.6, sim Lions 35 / Packers 65 (model picks Packers).
let out = applyCalibrationToResultText(simText('Lions', 35, 'Packers', 65), 'Lions', 'Packers', -12.6, 'NFL');
eq(pctOf(out, 'Packers'), 52, 'picking teamB: bias applied to teamB (65-12.6=52)');
eq(pctOf(out, 'Lions'), 48, 'picking teamB: teamA mirrored to 48');
eq(out.includes('Packers: 78% win rate'), false, 'picking teamB: no longer inflates to 78 (the old bug)');

// ---- 2. Picking teamA ----
out = applyCalibrationToResultText(simText('Lions', 65, 'Packers', 35), 'Lions', 'Packers', -12.6, 'NFL');
eq(pctOf(out, 'Lions'), 52, 'picking teamA: bias applied to teamA (65-12.6=52)');
eq(pctOf(out, 'Packers'), 48, 'picking teamA: teamB mirrored to 48');

// ---- 3. Positive bias APPLIES (symmetric since 2026-10-13) ----
// A league hitting above its stated confidence earns a raise on the picked side.
const plain60 = simText('Lions', 40, 'Packers', 60);
out = applyCalibrationToResultText(plain60, 'Lions', 'Packers', 5.2, 'NCAAF');
eq(pctOf(out, 'Packers'), 65, 'positive bias: picked side raised (60+5.2=65)');
eq(pctOf(out, 'Lions'), 35, 'positive bias: other side mirrored to 35');
out = applyCalibrationToResultText(plain60, 'Lions', 'Packers', 0.7, 'NCAAF');
eq(pctOf(out, 'Packers'), 61, 'small positive bias applies (60+0.7=61)');
eq(pctOf(out, 'Lions'), 39, 'small positive bias: mirrored to 39');

// ---- 4. Exact tie: teamA is the presumptive pick (matches [PICK] rule) ----
out = applyCalibrationToResultText(simText('Lions', 50, 'Packers', 50), 'Lions', 'Packers', -8, 'NFL');
eq(pctOf(out, 'Lions'), 42, 'tie: bias applied to teamA (first-listed pick)');
eq(pctOf(out, 'Packers'), 58, 'tie: teamB mirrored to 58');

// ---- 5. Guards unchanged ----
const plain = simText('Lions', 35, 'Packers', 65);
eq(applyCalibrationToResultText(plain, 'Lions', 'Packers', -0.4, 'NFL'), plain, '|bias| < 0.5 leaves text unchanged');
eq(applyCalibrationToResultText(plain, 'Lions', 'Packers', 0, 'NFL'), plain, 'zero bias leaves text unchanged');
eq(applyCalibrationToResultText('no percentages here', 'Lions', 'Packers', -12.6, 'NFL'), 'no percentages here', 'missing teamA match leaves text unchanged');

// ---- 6. Clamp applies to the picked side; percentages stay complementary ----
out = applyCalibrationToResultText(simText('Lions', 5, 'Packers', 95), 'Lions', 'Packers', -12.6, 'NFL');
eq(pctOf(out, 'Packers'), 82, 'clamp: teamB 95-12.6=82');
eq(pctOf(out, 'Lions'), 18, 'clamp: teamA mirrored to 18');
out = applyCalibrationToResultText(simText('Lions', 95, 'Packers', 5), 'Lions', 'Packers', -12.6, 'NFL');
eq(pctOf(out, 'Lions'), 82, 'negative bias on 95: 95-12.6=82');
eq(pctOf(out, 'Packers'), 18, 'negative bias on 95: mirrored to 18');

// ---- 7. Symmetric property: the picked side moves WITH the bias sign ----
let propFail = 0;
for (const bias of [-15, -10, -5.5, -1, -0.6, 0.6, 1, 5.2, 12.6]) {
  for (const [a, b] of [[65, 35], [35, 65], [50, 50], [90, 10], [10, 90], [58, 42]]) {
    const res = applyCalibrationToResultText(simText('Lions', a, 'Packers', b), 'Lions', 'Packers', bias, 'NFL');
    const newA = pctOf(res, 'Lions'), newB = pctOf(res, 'Packers');
    if (newA + newB !== 100) { propFail++; console.error(`FAIL: complementary broken (bias ${bias}, ${a}/${b} -> ${newA}/${newB})`); }
    // The picked side is the higher sim side (teamA on an exact tie, matching
    // the [PICK] rule) — it must move in the bias's direction, never against
    // it (clamping at 1/99 and rounding may hold it still, never reverse it).
    const pickedBefore = a >= b ? a : b, pickedAfter = a >= b ? newA : newB;
    if (bias > 0 && pickedAfter < pickedBefore) { propFail++; console.error(`FAIL: picked side fell on positive bias (bias ${bias}, ${a}/${b} -> ${newA}/${newB})`); }
    if (bias < 0 && pickedAfter > pickedBefore) { propFail++; console.error(`FAIL: picked side rose on negative bias (bias ${bias}, ${a}/${b} -> ${newA}/${newB})`); }
    if (newA < 1 || newA > 99 || newB < 1 || newB > 99) { propFail++; console.error(`FAIL: out of bounds (bias ${bias}, ${a}/${b} -> ${newA}/${newB})`); }
  }
}
eq(propFail, 0, 'symmetric property: picked side moves with the bias sign, always complementary, always 1-99');

// ---- 8. Calibration note reflects the shave or the raise ----
out = applyCalibrationToResultText(simText('Lions', 35, 'Packers', 65), 'Lions', 'Packers', -12.6, 'NFL');
eq(out.includes('shaved down by a computed calibration factor of -12.6 points'), true, 'note states the shave amount');
eq(out.includes('symmetric'), true, 'note states the factor is symmetric');
out = applyCalibrationToResultText(simText('Lions', 35, 'Packers', 65), 'Lions', 'Packers', 5.2, 'NFL');
eq(out.includes('raised up by a computed calibration factor of 5.2 points'), true, 'note states the raise amount');

// ---- 9. Stale-row epoch: pre-restore rows are treated as nonexistent ----
// supabaseUrl/supabaseHeaders are trivial plumbing (not under test); local
// equivalents keep the epoch tests on the real get/updateCalibrationBias
// without tripping fnBody on the `extra = {}` default-param braces.
function supabaseUrl(env) { return env.SUPABASE_URL || 'https://example.supabase.co'; }
function supabaseHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, ...extra };
}
eval(fnBody('isStaleCalibrationRow'));
eval('async ' + fnBody('getCalibrationBias'));
eval('async ' + fnBody('updateCalibrationBias'));
eval(src.match(/var CALIBRATION_EPOCH_ISO = "[^"]+";/)[0]);
eval(src.match(/var CALIBRATION_LEARNING_RATE = [0-9.]+;/)[0]);
eval(src.match(/var CALIBRATION_MAX_BIAS = [0-9]+;/)[0]);

const fakeEnv = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
let stubRows = [];
let lastPost = null;
let lastGetUrl = null;
global.fetch = async (url, opts = {}) => {
  if ((opts.method || 'GET').toUpperCase() === 'POST') {
    lastPost = JSON.parse(opts.body);
    return { ok: true, json: async () => ({}) };
  }
  lastGetUrl = url;
  return { ok: true, json: async () => stubRows };
};

async function epochTests() {
  eq(isStaleCalibrationRow(null), true, 'epoch: null row is stale');
  eq(isStaleCalibrationRow({}), true, 'epoch: row without updated_at is stale');
  eq(isStaleCalibrationRow({ updated_at: '2026-09-10T00:00:00.000Z' }), true, 'epoch: pre-restore row is stale');
  eq(isStaleCalibrationRow({ updated_at: '2026-09-29T21:35:00.000Z' }), true, 'epoch: row re-stamped in the unguarded window is stale');
  eq(isStaleCalibrationRow({ updated_at: '2026-09-29T21:39:40.000Z' }), false, 'epoch: row exactly at cutoff is fresh');
  eq(isStaleCalibrationRow({ updated_at: '2026-09-29T22:00:00.000Z' }), false, 'epoch: post-restore row is fresh');

  stubRows = [{ bias: -8.5, updated_at: '2026-09-10T00:00:00.000Z' }];
  eq(await getCalibrationBias(fakeEnv, 'meta', 'NFL'), 0, 'reader: stale row returns 0 (the fake-number fix)');
  eq(lastGetUrl.includes('updated_at'), true, 'reader: select fetches updated_at');
  stubRows = [{ bias: -8.5, updated_at: '2026-09-29T22:00:00.000Z' }];
  eq(await getCalibrationBias(fakeEnv, 'meta', 'NFL'), -8.5, 'reader: fresh row returns its bias');
  stubRows = [{ bias: 6.5, updated_at: '2026-09-29T22:00:00.000Z' }];
  eq(await getCalibrationBias(fakeEnv, 'meta', 'NFL'), 6.5, 'reader: fresh positive bias returns as-is (symmetric)');
  stubRows = [];
  eq(await getCalibrationBias(fakeEnv, 'meta', 'NFL'), 0, 'reader: no row returns 0');

  stubRows = [{ bias: -8.5, n_graded: 40, wins: 20, losses: 20, pushes: 2, updated_at: '2026-09-10T00:00:00.000Z' }];
  await updateCalibrationBias(fakeEnv, 'meta', 'NFL', 60, 'win');
  eq(lastPost.n_graded, 1, 'updater: stale row resets n_graded to 1');
  eq(lastPost.wins, 1, 'updater: stale row resets wins');
  eq(lastPost.losses, 0, 'updater: stale row resets losses');
  eq(lastPost.pushes, 0, 'updater: stale row resets pushes');
  eq(lastPost.bias, 1.2, 'updater: stale row bias restarts from 0 (win at 60% -> +1.2, symmetric)');

  stubRows = [{ bias: -2, n_graded: 10, wins: 5, losses: 5, pushes: 0, updated_at: '2026-09-29T22:00:00.000Z' }];
  await updateCalibrationBias(fakeEnv, 'meta', 'NFL', 60, 'loss');
  eq(lastPost.n_graded, 11, 'updater: fresh row increments n_graded');
  eq(lastPost.bias, -3.8, 'updater: fresh row accumulates (-2 + -1.8)');
  eq(lastPost.losses, 6, 'updater: fresh row increments losses');
  eq(typeof lastPost.updated_at === 'string' && lastPost.updated_at >= '2026-09-29', true, 'updater: upsert stamps fresh updated_at');

  stubRows = [{ bias: 14.5, n_graded: 10, wins: 8, losses: 2, pushes: 0, updated_at: '2026-09-29T22:00:00.000Z' }];
  await updateCalibrationBias(fakeEnv, 'meta', 'NFL', 60, 'win');
  eq(lastPost.bias, 15, 'updater: positive bias clamps at +15 (14.5 + 1.2)');
  stubRows = [{ bias: -14.5, n_graded: 10, wins: 2, losses: 8, pushes: 0, updated_at: '2026-09-29T22:00:00.000Z' }];
  await updateCalibrationBias(fakeEnv, 'meta', 'NFL', 60, 'loss');
  eq(lastPost.bias, -15, 'updater: negative bias clamps at -15 (-14.5 - 1.8)');
}

epochTests().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FATAL', e); process.exit(1); });
