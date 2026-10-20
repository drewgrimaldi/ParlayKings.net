// Regression test: slate date authority (Drew's rule — the run must not log
// games that can't grade).
//
// Board-runs ("Run today") POST each slate game to /api/chat with the board's
// authoritative eventDate. applySlateDateAuthority() overrides the model's own
// date guess with the board date on slate runs, because the grader matches
// picks to ESPN finals by EXACT Event Date — a model-guessed date strands the
// pick Pending. Non-slate chat predictions keep the model's date.
// Runs under plain node, no dependencies. Tests the REAL function by
// extracting it from ../src/index.js (never a copy).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

eval(extract('applySlateDateAuthority'));

// Silence the override log line during tests.
const origLog = console.log;
console.log = () => {};

function mkPick(eventDate) {
  return { league: 'Tennis', matchup: 'A vs B', winner: 'A', confidence: 60, eventDate };
}

// 1. Slate run: board date overrides the model's wrong guess.
{
  const pick = mkPick('2026-10-02'); // model guessed tomorrow
  const out = applySlateDateAuthority(pick, true, '2026-09-30'); // board says today
  assert.strictEqual(out.eventDate, '2026-09-30', 'slate run must take the board date');
  assert.strictEqual(out, pick, 'must mutate in place, not replace');
}

// 2. Slate run: matching dates are left alone.
{
  const pick = mkPick('2026-09-30');
  applySlateDateAuthority(pick, true, '2026-09-30');
  assert.strictEqual(pick.eventDate, '2026-09-30');
}

// 3. Slate run: model gave no date — board date fills it (no todayET fallback drift).
{
  const pick = mkPick(null);
  applySlateDateAuthority(pick, true, '2026-09-30');
  assert.strictEqual(pick.eventDate, '2026-09-30');
}

// 4. Non-slate chat prediction: model's date stands, board date ignored.
{
  const pick = mkPick('2026-10-05');
  applySlateDateAuthority(pick, false, '2026-09-30');
  assert.strictEqual(pick.eventDate, '2026-10-05', 'chat predictions must keep the model date');
}

// 5. Slate run with missing/invalid board date: fail open to the model's value.
{
  const pick = mkPick('2026-10-02');
  applySlateDateAuthority(pick, true, undefined);
  assert.strictEqual(pick.eventDate, '2026-10-02');
  applySlateDateAuthority(pick, true, 'tomorrow');
  assert.strictEqual(pick.eventDate, '2026-10-02');
  applySlateDateAuthority(pick, true, '');
  assert.strictEqual(pick.eventDate, '2026-10-02');
}

// 6. Null pick: no crash.
{
  assert.strictEqual(applySlateDateAuthority(null, true, '2026-09-30'), null);
}

console.log = origLog;
console.log('slate-date-authority: 6 checks passed');
