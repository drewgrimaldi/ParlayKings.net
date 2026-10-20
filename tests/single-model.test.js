// Single-model check: SAM 1.6 (Meta / Muse Spark 1.3) is the only model.
// Asserts the provider-target list has exactly one entry, the chat has no
// model picker UI at all (no dropdown, no label, no picker JS), the dead
// Gemini/Grok model stacks are gone, and the history-records KV cache
// helper exists.
// Runs under plain node.
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

// 1. Exactly one provider target: meta
const targets = fnBody('airtableProviderTargets');
eq((targets.match(/provider: "/g) || []).length, 1, 'airtableProviderTargets lists exactly one provider');
eq(targets.includes('provider: "meta"'), true, 'airtableProviderTargets targets meta');
eq(targets.includes('"grok"'), false, 'airtableProviderTargets has no grok target');
eq(targets.includes('"gemini"'), false, 'airtableProviderTargets has no gemini target');

// 2. No model picker UI at all: no dropdown, no options, no static label,
//    no picker JS. Single model only, nothing to show or switch.
//    (Changelog history entries may still describe the old picker.)
const clEndIdx = src.indexOf('\n];', src.indexOf('var CHANGELOG = ['));
const postChangelog = clEndIdx >= 0 ? src.slice(clEndIdx + 3) : src;
eq(postChangelog.includes('model-picker'), false, 'no model-picker markup/CSS outside changelog');
eq(postChangelog.includes('toggleModelPicker'), false, 'toggleModelPicker removed');
eq(postChangelog.includes('function setProvider('), false, 'setProvider removed');
eq(postChangelog.includes('model-picker-label'), false, 'no picker label element outside changelog');

// 3. Dead model stacks are gone (function definitions; changelog history may name them)
for (const dead of ['callGemini', 'requestGemini', 'geminiApiKeys', 'callGrok', 'requestGrok']) {
  eq(src.includes('function ' + dead + '('), false, 'dead function removed: ' + dead);
}
eq(src.includes('var TOOLS_GEMINI'), false, 'TOOLS_GEMINI removed');
eq(src.includes('var GEMINI_MODEL'), false, 'GEMINI_MODEL removed');

// 4. No user-facing multi-model copy remains outside changelog history
eq(postChangelog.includes('whichever you picked'), false, 'no "whichever you picked" copy outside changelog');

// 5. Replica provider check is constant now
const isPub = fnBody('isPublicReplicaProvider');
eq(isPub.includes('return true'), true, 'isPublicReplicaProvider is constant true');

// 6. History-records KV cache helper exists and is wired in
eq(src.includes('async function fetchGradedHistoryRecords(env, provider)'), true, 'fetchGradedHistoryRecords exists');
const fph = fnBody('fetchPredictionHistory');
eq(fph.includes('fetchGradedHistoryRecords(env, provider)'), true, 'fetchPredictionHistory uses the cached helper');
eq(fph.includes('history:graded:'), false, 'cache key lives in the helper, not the caller');
eq(src.includes('expirationTtl: 600'), true, 'history cache has a 10-minute TTL');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
