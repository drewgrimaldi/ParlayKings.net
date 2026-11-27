// Logged Confidence must equal the picked side's real simulation %.
//
// Regression: the post-hoc band-calibration rewrite used to pull the
// sim-locked number DOWN toward historical band hit rates (sim 64% shown
// and logged as 49%), so Confidence % disagreed with the logged Team A/B
// split. Tests the REAL bundle functions by extracting them from
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
  return { code: src.slice(start, i + 1), start, end: i + 1 };
}

const needed = ['stripDiacritics', 'matchName', 'teamNickname', 'oddsNameMatches',
  'simPctForWinner', 'simulationFromPickTag', 'lockPickToSimulation', 'extractPick'];
const ranges = {};
for (const fn of needed) {
  const r = extract(fn);
  ranges[fn] = r;
  eval(r.code);
}

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; }
  else { fail++; console.error('FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
}

// Pipeline replay: same steps /api/chat runs (extractPick -> sim lock ->
// Airtable field math), with no calibration rewrite in between.
function loggedFields(tag, sim) {
  const { pick } = extractPick(tag);
  const s = sim || simulationFromPickTag(pick);
  lockPickToSimulation(pick, s, '');
  return {
    // Same math as logBetToAirtable's Airtable write.
    confidence: Number.isFinite(pick.confidence) ? pick.confidence / 100 : void 0,
    teamA: Number.isFinite(pick.teamAWinPct) ? pick.teamAWinPct / 100 : void 0,
    teamB: Number.isFinite(pick.teamBWinPct) ? pick.teamBWinPct / 100 : void 0,
    winner: pick.winner,
  };
}

// Ohio State shape: model understates at 49, sim says 64/36.
(function () {
  const f = loggedFields(
    '[PICK: NCAAF | Ohio State Buckeyes vs Texas Longhorns | Ohio State Buckeyes | 49 | 2026-09-12 | 64 | 36] x.',
    { nameA: 'Ohio State Buckeyes', winPctA: 64, nameB: 'Texas Longhorns', winPctB: 36 });
  eq(f.confidence, 0.64, 'favorite pick logs sim %');
  eq(f.teamA + f.teamB, 1, 'sides sum to 100');

  // Temple shape: underdog pick logs its own side, not the max.
  const g = loggedFields(
    '[PICK: NCAAF | Penn State vs Temple | Temple | 49 | 2026-09-12 | 44 | 56] x.',
    { nameA: 'Penn State', winPctA: 44, nameB: 'Temple', winPctB: 56 });
  eq(g.confidence, 0.56, 'underdog pick logs picked side sim %');

  // Tag-only fallback path (lastSim null): still locks to the tag split.
  const h = loggedFields(
    '[PICK: NCAAF | Oregon Ducks vs Oklahoma State Cowboys | Oregon Ducks | 52 | 2026-09-12 | 68 | 32] x.',
    null);
  eq(h.confidence, 0.68, 'tag-fallback path logs sim %');

  // Structural guard: every pick.confidence write in the bundle must live
  // inside a sim-locking function (lockPickToSimulation /
  // applyTennisFiftyFiftyLock), the sanctioned band-calibration block,
  // the sanctioned tennis 50/50 stand (applyTennisFiftyFiftyStand, which only
  // ever writes the honest 50/50 coin-flip values), or the sanctioned
  // non-tennis force-side (forceNonTennisSide, which only ever writes 51%
  // for the higher sim side — Drew's standing rule, no non-tennis 50/50s),
  // or the sanctioned market-anchor flip inside _logBetToAirtableInner
  // (Drew's market-anchor rule, 2026-10-13: when a pick fades the market
  // outside the narrow dissent zone, the logged pick flips to the market
  // favorite and the confidence becomes the favorite's implied number,
  // floored at 51 — the pick's basis is the market, so its number is the
  // market's, stated openly in the record's anchor note).
  // The calibration block is a deliberate bounded exception: sim lock sets the
  // number first, then band calibration may pull it DOWN toward the band's
  // historical hit rate — never up (down-only clamp inside
  // applyBandCalibration, restored 2026-09-22 at Drew's call).
  const lockRanges = [ranges.lockPickToSimulation, extract('applyTennisFiftyFiftyLock'), extract('applyTennisFiftyFiftyStand'), extract('forceNonTennisSide')];
  const calAnchor = 'if (pick && !isFiftyFiftyWinner(pick.winner) && typeof pick.confidence';
  const calStart = src.indexOf(calAnchor);
  eq(calStart >= 0, true, 'band-calibration application block present');
  let calEnd = -1;
  if (calStart >= 0) {
    let i = src.indexOf('{', calStart), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') { depth--; if (!depth) break; }
    }
    calEnd = i;
  }
  const calBlock = calStart >= 0 ? src.slice(calStart, calEnd) : '';
  const anchorComment = src.indexOf('// Market anchor (2026-10-13): keep the logged pick');
  eq(anchorComment >= 0, true, 'market-anchor gate block present in the logger');
  let anchorRange = { start: -2, end: -1 };
  if (anchorComment >= 0) {
    const ifStart = src.indexOf('if (pick && !isFiftyFiftyWinner(pick.winner)) {', anchorComment);
    let i = src.indexOf('{', ifStart), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') { depth--; if (!depth) break; }
    }
    anchorRange = { start: ifStart, end: i };
  }
  eq(/calibratedConfidence > rawConfidence/.test(calBlock), false, 'down-only clamp is gone from the calibration block');
  eq(/var BAND_CALIBRATION_MAX_SHIFT_PTS/.test(src), false, 'symmetric clamp bound removed from bundle');
  const writes = [];
  const writeRe = /pick\.confidence =(?!=)/g;
  let m;
  while ((m = writeRe.exec(src)) !== null) writes.push(m.index);
  eq(writes.length > 0, true, 'bundle writes pick.confidence somewhere');
  // NFL confidence deflation block (2026-10-18): a sanctioned rewrite
  // site in the chat handler, immediately after band calibration.
  const defAnchor = 'applyNflConfidenceDeflation(preDeflation)';
  const defIdx = src.indexOf(defAnchor);
  eq(defIdx >= 0, true, 'NFL deflation application present');
  let defRange = { start: -2, end: -1 };
  if (defIdx >= 0) {
    const ifStart = src.lastIndexOf('if (pick && !isFiftyFiftyWinner(pick.winner)', defIdx);
    let i = src.indexOf('{', ifStart), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') { depth--; if (!depth) break; }
    }
    defRange = { start: ifStart, end: i };
  }
  // 80+ band cap block (2026-10-28): a sanctioned rewrite site in the
  // chat handler, immediately after the NFL deflation.
  const capAnchor = 'applyTopBandConfidenceCap(preCap)';
  const capIdx = src.indexOf(capAnchor);
  eq(capIdx >= 0, true, '80+ band cap application present');
  let capRange = { start: -2, end: -1 };
  if (capIdx >= 0) {
    const ifStart = src.lastIndexOf('if (pick && !isFiftyFiftyWinner(pick.winner)', capIdx);
    let i = src.indexOf('{', ifStart), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') { depth--; if (!depth) break; }
    }
    capRange = { start: ifStart, end: i };
  }
  const allowed = lockRanges.concat([{ start: calStart, end: calEnd }, anchorRange, defRange, capRange]);
  const strays = writes.filter((k) => !allowed.some((r) => k > r.start && k < r.end));
  eq(strays.length, 0, 'no pick.confidence rewrite outside sim lock + calibration + fifty stand + market anchor + NFL deflation + 80+ band cap');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
