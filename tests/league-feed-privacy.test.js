// League feeds (/api/league-picks) serve the model's prediction text
// only. The stored snapshot blocks (---ODDSLINE--- / ---POLYLINE---)
// and their gate vocabulary must never reach the public sites: the
// 2026-10-14 extraction cut at ODDSLINE but not POLYLINE (which did
// not exist yet), and on 2026-10-17 a UFC card on ufc.grimaldi.tv
// rendered a record's raw POLYLINE JSON - anchorQualified, volume,
// event slug - in its analysis area.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');
let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; } else { failed++; console.log('FAIL:', name); } };
const i = src.indexOf('const predictionOf');
const seg = src.slice(i, i + 2200);
check('predictionOf exists in the league-picks route', i !== -1);
check('extraction cuts at ---ODDSLINE---', seg.includes('"---ODDSLINE---"'));
check('extraction cuts at ---POLYLINE---', seg.includes('"---POLYLINE---"'));
check('extraction cuts at bare POLYLINE:', seg.includes('"POLYLINE:"'));
check('extraction still cuts the grade line', seg.includes('Auto-graded'));
check('extraction still cuts the result write-up', seg.includes('" · Result:"') || seg.includes('Result:'));
const si = src.indexOf('picks.sort(', i);
const sseg = src.slice(si, si + 420);
check('feed sorts pending picks first', si !== -1 && sseg.includes('pending'));
console.log(`league-feed-privacy: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
