// Replica seed guards (2026-10-23): the seed once (a) capped the replica at
// 3,000 records via a 30-page stop, silently dropping the oldest graded
// picks from the replica, the sheet, and the season counts, and (b) wrote
// an EMPTY replica over the good one whenever a page fetch failed — the
// empty book the sheet sync then mirrored, wiping the sheet. Both defects
// lived in seedBetsReplicaFromAirtable. Source-level pins, same style as
// bg-backstop: if either line comes back, this fails.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

const start = src.indexOf('async function seedBetsReplicaFromAirtable(');
if (start < 0) throw new Error('seedBetsReplicaFromAirtable missing from bundle');
let i = src.indexOf('{', start), depth = 0, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
}
const body = src.slice(start, end + 1);

eq(body.includes('page < 30'), false, 'no 30-page / 3000-record cap in the seed');
eq(body.includes('page < 500'), true, 'seed paginates to the end of the table (500-page runaway guard)');
eq(body.includes('seedError: true'), false, 'seed never writes a seedError state');
eq(src.includes('records: [], seedError: true'), false, 'no empty-replica overwrite anywhere in the bundle');
eq(body.includes('return null'), true, 'failed seed returns without saving');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
