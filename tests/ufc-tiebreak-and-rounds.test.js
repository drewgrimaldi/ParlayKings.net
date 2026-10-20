// UFC last-five exact-tie tiebreak (|raw-50| < 0.5) + explicit prelim-round logic.
// Drew's calls, 2026-09-23.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");

function extract(name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("missing fn " + name);
  const p = src.indexOf("(", start);
  let pd = 0, qi = p;
  for (; qi < src.length; qi++) {
    if (src[qi] === "(") pd++;
    if (src[qi] === ")") { pd--; if (!pd) break; }
  }
  let i = src.indexOf("{", qi), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}
function extractVar(name) {
  const s = src.indexOf("var " + name + " = ");
  if (s < 0) throw new Error("missing var " + name);
  return src.slice(s, src.indexOf(";", s) + 1);
}
for (const n of ["__name", "__name2", "__name22", "__name222", "__name2222",
  "__name22222", "__name222222", "__name2222222", "__name22222222",
  "__name222222222", "__name2222222222", "__name22222222222"])
  eval("var " + n + " = function (f) { return f; };");
eval(extractVar("UFC_WEIGHT_CLASS_SCALE"));
eval(extractVar("UFC_IMPORTANCE_WEIGHTS"));
eval(extractVar("UFC_ROUND_EDGE_SCALE"));
eval(extractVar("CONSERVATISM_SHRINKAGE"));
for (const fn of ["sampleNormal", "ufcNum", "ufcClampEdge", "ufcFinishRate",
  "ufcHeightInches", "ufcReachInches", "ufcStanceType", "ufcWeightClassScale",
  "ufcCountryKey", "ufcSameCountry", "ufcPhysicalNetEdge", "ufcFinishMixScale",
  "ufcWeightClassFinishBias", "ufcLastFiveTiebreak", "ufcWeightedCompositeEdge",
  "ufcScheduledRounds", "runUFCMultiStatSimulation"]) eval(extract(fn));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const realRandom = Math.random;

const rec = (wins, fights) => ({ fights, wins, winPct: Math.round(wins / fights * 100), last5: [] });
const FIVE_OH = rec(5, 5), TWO_THREE = rec(2, 5), THREE_TWO = rec(3, 5);

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, detail: cond ? "" : (detail || "FAILED") });
}

// ---- tiebreak unit checks (pure, deterministic) ----
let t = ufcLastFiveTiebreak(50.2, { recent: FIVE_OH }, { recent: TWO_THREE });
check("in-band 50.2, 5-0 vs 2-3 -> 5-0 fighter picked", t.adjRawA === 51 && t.note !== null, JSON.stringify(t));
check("in-band note states the dead-even split and last-five", /Dead even on the sim \(50\.2-49\.8\)/.test(t.note || "") && /5-0 vs 2-3/.test(t.note || ""), t.note);

t = ufcLastFiveTiebreak(49.8, { recent: TWO_THREE }, { recent: FIVE_OH });
check("in-band 49.8, 2-3 vs 5-0 -> 5-0 fighter picked (side B)", t.adjRawA === 49 && t.note !== null, JSON.stringify(t));

t = ufcLastFiveTiebreak(50.9, { recent: FIVE_OH }, { recent: TWO_THREE });
check("50.9-49.1 is a decision, not a tiebreak", t.adjRawA === 50.9 && t.note === null, JSON.stringify(t));

t = ufcLastFiveTiebreak(50.1, { recent: THREE_TWO }, { recent: THREE_TWO });
check("last-five tied -> raw higher side stands, no note", t.adjRawA === 50.1 && t.note === null, JSON.stringify(t));

t = ufcLastFiveTiebreak(50.1, {}, {});
check("no last-five data -> no tiebreak", t.adjRawA === 50.1 && t.note === null, JSON.stringify(t));

t = ufcLastFiveTiebreak(49.5, { recent: FIVE_OH }, { recent: TWO_THREE });
check("exactly 49.5 is outside the band (|raw-50| >= 0.5)", t.adjRawA === 49.5 && t.note === null, JSON.stringify(t));

// ---- tiebreak integration: real sim, seeded, lands in the band ----
// Form is a real 10% composite factor now, so a 5-0 vs 2-3 gap alone moves the
// sim out of the tiebreak band. To test the exact-close mechanism, B gets a
// compensating takedown-defense edge (10% factor) so the weighted composite
// nets to ~0 and the sim lands dead-even; the last-five tiebreak still breaks
// it for the 5-0 fighter.
const base = {
  strikeLPM: 5.0, strikeAccuracy: 48, sapm: 4.6, strikeDefense: 55,
  takedownDefense: 60, takedownAvg: 1.8, takedownAccuracy: 40, submissionAvg: 0.5,
  reach: 72, height: 70, stance: "Orthodox", age: 29, weightClass: "Welterweight"
};
const simA = Object.assign({}, base, { recent: FIVE_OH });
const simB = Object.assign({}, base, { recent: TWO_THREE, takedownDefense: 65 });
Math.random = mulberry32(42);
const simRes = runUFCMultiStatSimulation(simA, simB, 25000, 3, null);
Math.random = realRandom;
check("sim tiebreak fired on composite-balanced dead-even sim, 5-0 vs 2-3", simRes.tiebreak !== null, "tiebreak=" + simRes.tiebreak);
check("tiebreak note breaks the tie for the 5-0 fighter", /5-0/.test(simRes.tiebreak || ""),
  "tiebreak=" + simRes.tiebreak);
check("tiebreak shrinks normally under 0.40 shrinkage (50-50, not raw 51-49)", simRes.winPctA === 50 && simRes.winPctB === 50,
  "winPctA=" + simRes.winPctA + " winPctB=" + simRes.winPctB);

// ---- explicit prelim-round logic ----
check("prelim bout (periods 3, no title) -> 3 rounds",
  ufcScheduledRounds({ format: { regulation: { periods: 3 } }, types: [], description: null }).rounds === 3);
check("prelim with missing/ambiguous description -> 3 rounds explicitly",
  ufcScheduledRounds({}).rounds === 3 &&
  ufcScheduledRounds({ description: "Lightweight Bout" }).rounds === 3);
check("title fight -> 5 rounds",
  ufcScheduledRounds({ types: [{ text: "Title" }], format: { regulation: { periods: 5 } } }).rounds === 5 &&
  ufcScheduledRounds({ types: [{ text: "Title" }] }).isTitleFight === true);
check("main event (ESPN periods 5, no title type) -> 5 rounds",
  ufcScheduledRounds({ types: [], format: { regulation: { periods: 5 } } }).rounds === 5);
check("description '5 Rnd' kept as cross-check -> 5 rounds",
  ufcScheduledRounds({ types: [], description: "5 Rnd (5:00)" }).rounds === 5);
check("description '3 Rnd' does not force 5 -> 3 rounds",
  ufcScheduledRounds({ types: [], description: "3 Rnd (5:00)" }).rounds === 3);

// ---- rounds verification: the sim runs the exact round count ----
// source-level: loop bound uses safeRounds, no hardcoded 3/5 in the loop path
const simSrc = extract("runUFCMultiStatSimulation");
check("loop iterates exactly safeRounds times (rnd < safeRounds)",
  /for\s*\(\s*let rnd\s*=\s*0;\s*rnd < safeRounds/.test(simSrc));
check("safeRounds normalizes the rounds param (5 ? 5 : 3)",
  /const safeRounds = rounds === 5 \? 5 : 3;/.test(simSrc));
check("no hardcoded round literal in the loop bound",
  !/rnd\s*<\s*[0-9]/.test(simSrc));
check("round-dependent math scales with rnd (fatigue fade per round)",
  /1 - rnd \* cardioFadePerRound/.test(simSrc));

// behavioral: identical matchup, 3 vs 5 rounds -> materially different finish rate
const fav = {
  strikeLPM: 6.2, strikeAccuracy: 52, sapm: 3.8, strikeDefense: 56,
  takedownDefense: 62, takedownAvg: 2.0, takedownAccuracy: 42, submissionAvg: 0.5,
  reach: 73, height: 71, stance: "Orthodox", age: 28, weightClass: "Lightweight"
};
const dog = {
  strikeLPM: 4.9, strikeAccuracy: 44, sapm: 5.0, strikeDefense: 52,
  takedownDefense: 58, takedownAvg: 1.2, takedownAccuracy: 36, submissionAvg: 0.3,
  reach: 71, height: 69, stance: "Orthodox", age: 30, weightClass: "Lightweight"
};
const r3 = runUFCMultiStatSimulation(fav, dog, 12000, 3, null);
const r5 = runUFCMultiStatSimulation(fav, dog, 12000, 5, null);
const finPct = (r) => r.methodA.ko + r.methodA.sub + r.methodB.ko + r.methodB.sub;
check("5 rounds produces a materially higher finish rate than 3 (more per-round rolls)",
  finPct(r5) > finPct(r3) + 5, "3rd=" + finPct(r3) + "% 5rd=" + finPct(r5) + "%");

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log((c.pass ? "PASS" : "FAIL") + " | " + c.name + (c.detail ? " -- " + c.detail : ""));
console.log(failed.length + " failed, " + (checks.length - failed.length) + " passed");
process.exit(failed.length ? 1 : 0);
