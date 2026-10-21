// Composites restored wiring test (2026-10-20).
//
// Drew's direct order: "Turn back on my factor on everything — I want
// my weights back on everything." The NHL 8-factor composite had been
// switched off 2026-10-09 behind an `if (false && ...)` guard and the
// NBA/CBB 12-factor composite had been switched off 2026-10-08 (its
// caller removed; the function and weights table stayed in the bundle).
// The function-level suites (nhl-importance-weights, nba-12-factor)
// pin the math and the exact weights; this file pins the WIRING: both
// composites are called in the sim core again, their edges reach the
// bridge fields, and WNBA stays on the legacy path it always ran.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + label); }
}

// --- NHL caller is live ---
check('NHL: the false guard is gone', !src.includes('if (false && key === "NHL")'));
check('NHL: caller runs for the NHL key', src.includes('if (key === "NHL") {'));
check('NHL: caller invokes the composite', src.includes('nhlWeightedCompositeEdge({'));
check('NHL: edge reaches the bridge field', src.includes('contextA.nhlEdgeGoals = comp.edge / 2'));
check('NHL: composite-on flag set', src.includes('contextA.nhlCompositeOn = true'));

// --- NBA/CBB caller exists and wires the bridge ---
check('NBA: caller runs for NBA and CBB', src.includes('if (key === "NBA" || key === "CBB") {'));
check('NBA: caller invokes the composite with the sim inputs', src.includes('nbaWeightedCompositeEdge({ teamA, teamB, statsA, statsB, ctxA: contextA, ctxB: contextB, league: key })'));
check('NBA: edge reaches the bridge field', src.includes('contextA.basketballEdgePts = comp.edge / 2'));
check('NBA: composite-on flag set (legacy factor neutralized in the multiplier)', src.includes('contextA.basketballCompositeOn = true'));
check('NBA: composite line is written for the writeup', src.includes('Weighted 12-factor composite edge'));

// --- WNBA unchanged: legacy path, its own condition ---
check('WNBA: legacy path is WNBA-only now', src.includes('if (key === "WNBA") {'));
check('WNBA: legacy factor still assigned', src.includes('contextA.basketballFactor = packA.factor'));

// --- Bridge still applies both edges ---
check('bridge: NHL edge applied to lambdas', src.includes('lambdaA + contextA.nhlEdgeGoals'));
check('bridge: basketball edge applied to lambdas', src.includes('lambdaA + contextA.basketballEdgePts'));

// --- Weights are the originals (spot checks; full tables pinned by the
//     function-level suites) ---
check('weights: NHL xGF 25 / GSAx 20 intact', src.includes('{ key: "xgf",   label: "xGF%",                    weight: 0.25  }') && src.includes('{ key: "gsax",  label: "GSAx (probable starter)", weight: 0.20  }'));
check('weights: NBA netRtg 20 / eFG 15 intact', src.includes('{ key: "netRtg",     label: "Adjusted Net Rating",           weight: 0.20 }') && src.includes('{ key: "efg",        label: "Effective FG%",                 weight: 0.15 }'));

console.log(`composites-restored: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
