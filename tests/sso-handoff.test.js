// Single sign-on wiring (2026-10-14): one identity across parlaykings.net
// and the whole grimaldi.tv family. The handoff mints a signed token from
// the visitor's session on the current host; the consume step must run on
// a worker host that can plant what the destination needs — the SAM
// session cookie for a parlaykings destination, the shared .grimaldi.tv
// identity cookies (via ai.grimaldi.tv) for any league destination — and
// the post-consume redirect may only go to an allowlisted destination.
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/../src/index.js", "utf8");

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start !== -1, `function ${name} not found`);
  let depth = 0, end = -1;
  const braceStart = src.indexOf("{", start);
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert(end !== -1, `function ${name} unterminated`);
  return src.slice(start, end);
}

const setMatch = src.match(/var SSO_ALLOWED_HOSTS = [^;]*?new Set\(\[([\s\S]*?)\]\);/);
assert(setMatch, "SSO_ALLOWED_HOSTS set literal not found");
const SSO_ALLOWED_HOSTS = new Set(eval(`[${setMatch[1]}]`));

const factory = new Function(
  "SSO_ALLOWED_HOSTS",
  `${extractFn("normalizeSsoDestination")}\n${extractFn("safeNextPath")}\n${extractFn("ssoConsumeOriginFor")}\n${extractFn("ssoPostConsumeLocation")}\nreturn { normalizeSsoDestination, safeNextPath, ssoConsumeOriginFor, ssoPostConsumeLocation };`
);
const { normalizeSsoDestination, ssoConsumeOriginFor, ssoPostConsumeLocation } = factory(SSO_ALLOWED_HOSTS);

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log("sso-handoff.test.js");

check("every family host is an allowed destination", () => {
  for (const h of ["parlaykings.net", "www.parlaykings.net", "grimaldi.tv", "ai.grimaldi.tv",
    "football.grimaldi.tv", "mlb.grimaldi.tv", "basketball.grimaldi.tv", "ufc.grimaldi.tv",
    "wnba.grimaldi.tv", "tennis.grimaldi.tv", "nhl.grimaldi.tv", "trivia.grimaldi.tv"]) {
    assert.strictEqual(normalizeSsoDestination(`https://${h}/`), `https://${h}/`, h);
  }
});

check("destination keeps its path and query", () => {
  assert.strictEqual(normalizeSsoDestination("https://parlaykings.net/stats?x=1"), "https://parlaykings.net/stats?x=1");
  assert.strictEqual(normalizeSsoDestination("https://nhl.grimaldi.tv/"), "https://nhl.grimaldi.tv/");
});

check("foreign, lookalike, and non-https destinations are rejected", () => {
  assert.strictEqual(normalizeSsoDestination("https://evil.com/"), null);
  assert.strictEqual(normalizeSsoDestination("https://nhl.grimaldi.tv.evil.com/"), null);
  assert.strictEqual(normalizeSsoDestination("http://nhl.grimaldi.tv/"), null);
  assert.strictEqual(normalizeSsoDestination("not a url"), null);
  // An empty destination defaults to the parlaykings home page (the
  // function's standing contract, also used by the handoff fallback).
  assert.strictEqual(normalizeSsoDestination(""), "https://parlaykings.net/");
});

check("consume runs on the destination's own origin for parlaykings", () => {
  assert.strictEqual(ssoConsumeOriginFor("https://parlaykings.net/stats"), "https://parlaykings.net");
  assert.strictEqual(ssoConsumeOriginFor("https://www.parlaykings.app/"), "https://www.parlaykings.app");
});

check("consume runs on ai.grimaldi.tv for every grimaldi.tv destination", () => {
  assert.strictEqual(ssoConsumeOriginFor("https://nhl.grimaldi.tv/"), "https://ai.grimaldi.tv");
  assert.strictEqual(ssoConsumeOriginFor("https://basketball.grimaldi.tv/"), "https://ai.grimaldi.tv");
  assert.strictEqual(ssoConsumeOriginFor("https://grimaldi.tv/"), "https://ai.grimaldi.tv");
});

check("post-consume redirect honors allowlisted absolute destinations", () => {
  assert.strictEqual(ssoPostConsumeLocation("https://nhl.grimaldi.tv/"), "https://nhl.grimaldi.tv/");
  assert.strictEqual(ssoPostConsumeLocation("https://parlaykings.net/about"), "https://parlaykings.net/about");
});

check("post-consume redirect refuses open redirects", () => {
  assert.strictEqual(ssoPostConsumeLocation("https://evil.com/phish"), "/");
  assert.strictEqual(ssoPostConsumeLocation("//evil.com"), "/");
  assert.strictEqual(ssoPostConsumeLocation(null), "/");
  assert.strictEqual(ssoPostConsumeLocation("/stats"), "/stats");
});

check("handlers are wired to the helpers", () => {
  assert(src.includes('new URL("/sso/consume", ssoConsumeOriginFor(dest))'), "handoff must build consume on ssoConsumeOriginFor");
  assert(src.includes('consumeUrl.searchParams.set("next", dest)'), "handoff must carry the full destination as next");
  assert(src.includes('ssoPostConsumeLocation(url.searchParams.get("next"))'), "consume must resolve its redirect via ssoPostConsumeLocation");
});

check("the SAM nav routes every sports property through the handoff", () => {
  const links = src.match(/href="\/sso\/handoff\?to=https:\/\//g) || [];
  assert.strictEqual(links.length, 16, `expected 16 rewired nav links, found ${links.length}`);
});

console.log(`sso-handoff.test.js: ${passed} checks passed`);
