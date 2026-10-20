// The odds snapshot must survive grading (2026-10-15). The snapshot JSON
// is appended to a pick's Notes at log time, but the grade-time write-up
// is appended AFTER it — so an extractor that parses "from the marker to
// the end of the string" fails on every graded record, and the market
// tags in the model's private diagnostics (sided / dissent) silently
// never fired. The extractor now parses the first balanced JSON object
// after the marker. These fixtures pin that behavior, including the
// real graded-notes shape.
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/../src/index.js", "utf8");

function extractFn(name) {
  const m = src.match(new RegExp(`^function ${name}\\(`, "m"));
  assert(m, `function ${name} not found`);
  const start = m.index;
  const nxt = src.slice(start + 10).match(/^(?:async )?function \w+\(/m);
  const end = nxt ? start + 10 + nxt.index : src.length;
  return src.slice(start, end).replace(/__name\d*\([^)]*\);\n?/g, "");
}

const factory = new Function(
  `${extractFn("extractOddsSnapshotFromNotes")}
const FULL_REPLY_MARKER = "\\n\\n---FULLREPLY---\\n";
${extractFn("appendFullReplyToNotes")}
${extractFn("appendOddsSnapshotToNotes")}
${extractFn("appendPolymarketSnapshotToNotes")}
${extractFn("reorientSnapshotForFlip")}
${extractFn("parseAmericanPrice")}
${extractFn("parseOpeningLineFromText")}
${extractFn("notesWithReplyAndOdds")}
return { extractOddsSnapshotFromNotes, notesWithReplyAndOdds };`
);
const { extractOddsSnapshotFromNotes, notesWithReplyAndOdds } = factory();

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log("odds-snapshot.test.js");

const SNAP = JSON.stringify({
  bookmakerTitle: "DraftKings", winnerPrice: 109, winnerImplied: 48,
  otherName: "Cleveland Guardians", otherPrice: -122, otherImplied: 55
});

check("snapshot at the very end of the notes parses", () => {
  const snap = extractOddsSnapshotFromNotes(`Auto-logged · Q: Rays vs Guardians\n---ODDSLINE---${SNAP}`);
  assert(snap && snap.winnerImplied === 48 && snap.winnerPrice === 109);
});

check("snapshot followed by a grade-time write-up still parses (the graded shape)", () => {
  const notes = `Auto-logged · Q: Rays vs Guardians\n---ODDSLINE---${SNAP} · Result: Guardians 3, Rays 2. Cleveland outhit Tampa Bay 6-3. Pick: Tampa Bay Rays (52%) — Loss.`;
  const snap = extractOddsSnapshotFromNotes(notes);
  assert(snap && snap.winnerImplied === 48 && snap.otherName === "Cleveland Guardians", "graded-shape snapshot must parse");
});

check("no marker, no snapshot", () => {
  assert.strictEqual(extractOddsSnapshotFromNotes("Auto-logged · Q: A vs B"), null);
  assert.strictEqual(extractOddsSnapshotFromNotes(""), null);
  assert.strictEqual(extractOddsSnapshotFromNotes(null), null);
});

check("a snapshot without a winner price is rejected", () => {
  const bad = JSON.stringify({ bookmakerTitle: "X", winnerImplied: 48 });
  assert.strictEqual(extractOddsSnapshotFromNotes(`---ODDSLINE---${bad}`), null);
});

check("malformed JSON after the marker is rejected, not thrown", () => {
  assert.strictEqual(extractOddsSnapshotFromNotes(`---ODDSLINE---{not json`), null);
});

// --- The logger fallback (2026-10-15): when the reply text carries no
// parseable market line, the snapshot comes from the odds the analysis
// actually fetched (pick._marketOdds, stashed by fetchMarketOdds).
const STASH = {
  bookmakerTitle: "FanDuel", winnerPrice: -150, winnerImplied: 60,
  otherName: "Boston Celtics", otherPrice: 130, otherImplied: 43
};
const LINE_TEXT = "Analysis text.\n\n---\n**Market Line (DraftKings):** The books have Miami Heat at +109 (48% implied) with Cleveland Guardians getting -122 (55% implied).";

check("no market line in the text: the fetched-odds stash fills the snapshot", () => {
  const notes = notesWithReplyAndOdds("Auto-logged · Q: A vs B", "Plain analysis, no line.", { winner: "A", _marketOdds: STASH });
  const snap = extractOddsSnapshotFromNotes(notes);
  assert(snap && snap.winnerPrice === -150 && snap.bookmakerTitle === "FanDuel", "stash snapshot must be stored");
});

check("a parseable market line still wins over the stash (unchanged behavior)", () => {
  const notes = notesWithReplyAndOdds("Auto-logged · Q: A vs B", LINE_TEXT, { winner: "Miami Heat", _marketOdds: STASH });
  const snap = extractOddsSnapshotFromNotes(notes);
  assert(snap && snap.winnerPrice === 109 && snap.bookmakerTitle === "DraftKings", "text parse must take precedence");
});

check("anchor flips store the stash RE-ORIENTED to the logged side, never pre-flip-aligned", () => {
  const pick = { winner: "Cleveland Guardians", _marketOdds: STASH,
    _anchorNote: "Market anchor: pick follows the market favorite Cleveland Guardians (55% implied); the sim had Miami Heat at 52% (market 48% implied), outside the dissent zone.",
    _anchorFlip: { dogName: "Miami Heat", dogImplied: 48, favImplied: 55, source: "Market" } };
  const notes = notesWithReplyAndOdds("Auto-logged · Q: A vs B", "Plain analysis, no line.", pick);
  const snap = extractOddsSnapshotFromNotes(notes);
  assert(snap, "a flipped pick with flip context stores its snapshot");
  assert.strictEqual(snap.winnerPrice, STASH.otherPrice, "winner fields carry the favorite (logged) side");
  assert.strictEqual(snap.otherName, "Miami Heat", "the faded side is recorded as other");
  assert.strictEqual(snap.anchorFlipped, true, "the re-basing is marked");
});

check("an anchor note without flip context stores no snapshot (cannot re-orient safely)", () => {
  const pick = { winner: "Cleveland Guardians", _marketOdds: STASH, _anchorNote: "Market anchor: pick follows the market favorite Cleveland Guardians (55% implied); the sim had Miami Heat at 52% (market 48% implied), outside the dissent zone." };
  const notes = notesWithReplyAndOdds("Auto-logged · Q: A vs B", "Plain analysis, no line.", pick);
  assert.strictEqual(extractOddsSnapshotFromNotes(notes), null, "a flipped pick must not store the pre-flip-aligned stash");
});

check("no stash and no line: notes carry no snapshot, exactly as before", () => {
  const notes = notesWithReplyAndOdds("Auto-logged · Q: A vs B", "Plain analysis, no line.", { winner: "A" });
  assert.strictEqual(extractOddsSnapshotFromNotes(notes), null);
});

console.log(`odds-snapshot.test.js: ${passed} checks passed`);
