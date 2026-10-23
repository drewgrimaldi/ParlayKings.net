// Cron-backstop regression: notify jobs start on enqueue, so the minute
// cron only retries what got stuck. A "running" job that started minutes ago
// died mid-flight and must be retried; a freshly-running one must be left
// alone (no double run); pending always runs oldest-first. Runs under plain
// node, no dependencies. Tests the REAL processBgJobs extracted from
// ../src/index.js (never a copy); only KV and the runner are stubbed.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

// ---- fakes ----
const kvData = {};
const deleted = [];
const kv = {
  async list() { return { keys: Object.keys(kvData).map((k) => ({ name: k })) }; },
  async get(k) { return kvData[k] || null; },
  async put(k, v) { kvData[k] = String(v); },
  async delete(k) { deleted.push(k); delete kvData[k]; },
};
function replicaKv() { return kv; }
const ran = [];
async function runBgJob(env, ctx, kvArg, job) { ran.push(job.id); }
const env = {};
const ctx = {};

// Bundle constants the extracted function closes over (same values as src).
var BGJOB_PREFIX = 'bgjob:';
var BGJOB_TTL = 86400;
eval(extract('processBgJobs'));

let pass = 0, fail = 0;
function show(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + show(actual) + ', want ' + show(expected) + ')'); }
}
function reset() {
  for (const k of Object.keys(kvData)) delete kvData[k];
  deleted.length = 0;
  ran.length = 0;
}
function putJob(j) { kvData['bgjob:' + j.id] = JSON.stringify(j); }
const now = Date.now();

(async () => {
  // 1. Pending jobs run, oldest first.
  reset();
  putJob({ id: 'new', status: 'pending', createdAt: now - 1000 });
  putJob({ id: 'old', status: 'pending', createdAt: now - 5000 });
  await processBgJobs(env, ctx);
  eq(JSON.stringify(ran), JSON.stringify(['old', 'new']), 'pending jobs run oldest-first');

  // 2. A freshly-running job is left alone (the enqueue run owns it).
  reset();
  putJob({ id: 'live', status: 'running', startedAt: now - 60 * 1000, createdAt: now - 61000 });
  await processBgJobs(env, ctx);
  eq(ran.length, 0, 'fresh running job not double-run');

  // 3. A running job stuck for 10 minutes died mid-flight: retry it.
  reset();
  putJob({ id: 'stuck', status: 'running', startedAt: now - 10 * 60 * 1000, createdAt: now - 10 * 60 * 1000 });
  await processBgJobs(env, ctx);
  eq(JSON.stringify(ran), JSON.stringify(['stuck']), 'stuck running job retried by backstop');

  // 4. Fresh done jobs are kept; ancient ones are cleaned up, never rerun.
  reset();
  putJob({ id: 'fresh-done', status: 'done', doneAt: now, createdAt: now - 1000 });
  putJob({ id: 'ancient', status: 'done', doneAt: 0, createdAt: 0 });
  await processBgJobs(env, ctx);
  eq(ran.length, 0, 'done jobs never rerun');
  eq(deleted.indexOf('bgjob:ancient') >= 0, true, 'ancient done job cleaned up');
  eq(deleted.indexOf('bgjob:fresh-done') >= 0, false, 'fresh done job kept');

  // 5. The enqueue path runs the job object directly, never a re-list.
  eq(src.indexOf('ctx.waitUntil(runBgJob(env, ctx, jobKv, job, { immediate: true })') >= 0, true, 'enqueue starts this job immediately');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: harness threw: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
