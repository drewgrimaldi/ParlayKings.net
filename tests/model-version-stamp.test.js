// The pick stamp must be the running model version (2026-10-15). The
// logger's label function once returned a hardcoded "SAM 1.6.1", which
// survived the SAM 1.7 bump and stamped the entire first 1.7 slate with
// the old version — the era cut existed on the changelog page but not in
// the book. These checks pin the stamp to SAM_VERSION, which derives
// from the changelog head, so a version bump can never strand it again.
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/../src/index.js", "utf8");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log("model-version-stamp.test.js");

check("SAM_VERSION derives from the changelog head", () => {
  assert(src.includes("var SAM_VERSION = `SAM ${CHANGELOG[0].version}`;"), "SAM_VERSION must derive from CHANGELOG[0].version");
});

check("the changelog head is SAM 1.7.2", () => {
  const head = src.match(/var CHANGELOG = \[\s*\{\s*version: "([^"]+)"/);
  assert(head, "changelog head not found");
  assert.strictEqual(head[1], "1.7.2");
});

check("providerModelLabel returns SAM_VERSION, not a hardcoded stamp", () => {
  const fn = src.match(/function providerModelLabel\(provider\) \{([\s\S]*?)\n\}/);
  assert(fn, "providerModelLabel not found");
  assert(fn[1].includes("return SAM_VERSION;"), "providerModelLabel must return SAM_VERSION");
  assert(!/return "SAM /.test(fn[1]), "providerModelLabel must not return a hardcoded SAM label");
});

check("no hardcoded SAM version stamp remains in the logging path", () => {
  assert(!src.includes('return "SAM 1.6.1";'), "hardcoded 1.6.1 stamp still present");
});

console.log(`model-version-stamp.test.js: ${passed} checks passed`);
