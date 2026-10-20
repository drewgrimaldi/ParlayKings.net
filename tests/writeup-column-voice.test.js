// Column-voice writeup templates (Drew, 2026-09-24): prediction prose reads like a
// stats-heavy sports column — flowing prose, dense with numbers. Every number the
// old label-colon format showed must still appear, woven into sentences.
// Tests the REAL functions from ../src/index.js (never copies). Plain node.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let p = src.indexOf('(', start), pd = 0, qi = p;
  for (; qi < src.length; qi++) {
    if (src[qi] === '(') pd++;
    if (src[qi] === ')') { pd--; if (!pd) break; }
  }
  let i = src.indexOf('{', qi), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

for (const n of ['isFiftyFiftyWinner', 'formatOddsLine', 'matchupSideNames', 'oddsLookupWinner', 'parseAmericanPrice', 'formatCurrentMarketLine', 'buildLineMovementComment', 'parseOpeningLineFromText']) {
  eval(extract(n));
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

const BANNED = ['BET', 'HOLD', 'PASS', 'Kelly', 'stake', 'fair ', 'or better'];
function noBanned(out, label) {
  for (const b of BANNED) check(`${label}: no edge-gate residue ${JSON.stringify(b)}`, !out.includes(b));
}
function noSam(out, label) {
  check(`${label}: no internal SAM name`, !/\bSAM\b/.test(out));
}

const dk = { bookmakerTitle: 'DraftKings', winnerPrice: -150, winnerImplied: 60, otherName: 'Red Sox', otherPrice: 130, otherImplied: 43.5 };

// ---- edge+ ----
let out = formatCurrentMarketLine(dk, { winner: 'Yankees', confidence: 70, matchup: 'Yankees vs Red Sox', league: 'MLB' });
check('edge+: kicker intact', out.startsWith('\n\n---\n**Market Line (DraftKings):**'));
check('edge+: column lead', out.includes('The books have Yankees at -150 (60% implied)'));
check('edge+: other side woven in', out.includes('with Red Sox getting +130 (43.5% implied)'));
check('edge+: keeps postmortem edge marker', out.includes('**+10% edge**') && out.includes('over the market'));
check('edge+: states sim vs implied', out.includes('70% in the sims') && out.includes('60% implied'));
check('edge+: ParlayKings branded', out.includes('ParlayKings'));
noBanned(out, 'edge+');
noSam(out, 'edge+');

// ---- edge- ----
out = formatCurrentMarketLine(
  { bookmakerTitle: 'DraftKings', winnerPrice: -200, winnerImplied: 67, otherName: 'Bears', otherPrice: 170, otherImplied: 37 },
  { winner: 'Packers', confidence: 55, matchup: 'Packers vs Bears', league: 'NFL' });
check('edge-: keeps postmortem below marker', out.includes('**12% below**'));
check('edge-: all numbers present', out.includes('-200') && out.includes('67% implied') && out.includes('+170') && out.includes('37% implied') && out.includes('55%'));
noBanned(out, 'edge-');
noSam(out, 'edge-');

// ---- aligned ----
out = formatCurrentMarketLine(
  { bookmakerTitle: 'DraftKings', winnerPrice: 114, winnerImplied: 47, otherName: 'Liberty Flames', otherPrice: -135, otherImplied: 57 },
  { winner: 'Coastal Carolina Chanticleers', confidence: 49, matchup: 'Coastal Carolina Chanticleers vs Liberty Flames', league: 'CFB' });
check('aligned: keeps roughly-aligned marker', /roughly aligned/i.test(out));
check('aligned: all numbers present', out.includes('+114') && out.includes('47% implied') && out.includes('-135') && out.includes('57% implied') && out.includes('49%'));
noBanned(out, 'aligned');
noSam(out, 'aligned');

// ---- 50/50 ----
out = formatCurrentMarketLine(
  { bookmakerTitle: 'DraftKings', winnerPrice: -110, winnerImplied: 52, otherName: 'Fighter B', otherPrice: -110, otherImplied: 52 },
  { winner: '50/50', confidence: 50, matchup: 'Fighter A vs Fighter B', league: 'UFC' });
check('50/50: honest note survives', out.includes('50/50, not a side'));
check('50/50: no edge/below markers', !/\*\*\+\d+% edge\*\*/.test(out) && !/\*\*\d+% below\*\*/.test(out));
noBanned(out, '50/50');
noSam(out, '50/50');

// ---- no other side ----
out = formatCurrentMarketLine(
  { bookmakerTitle: 'DraftKings', winnerPrice: -150, winnerImplied: 60, otherName: '', otherPrice: null, otherImplied: null },
  { winner: 'Yankees', confidence: 62, matchup: 'Yankees vs Red Sox', league: 'MLB' });
check('no-other: renders cleanly', out.includes('The books have Yankees at -150 (60% implied).'));
noSam(out, 'no-other');

// ---- parser: new format round-trip ----
const newTxt = '\n\n---\n**Market Line (DraftKings):** The books have Yankees at -150 (60% implied) with Red Sox getting +130 (43.5% implied). ParlayKings sees **+10% edge** over the market on Yankees.';
let p = parseOpeningLineFromText(newTxt);
check('parse-new: book', p && p.bookmakerTitle === 'DraftKings');
check('parse-new: winner price/implied', p && p.winnerPrice === -150 && p.winnerImplied === 60);
check('parse-new: other side + decimal implied', p && p.otherName === 'Red Sox' && p.otherPrice === 130 && p.otherImplied === 43.5);

// ---- parser: new format, no other side ----
p = parseOpeningLineFromText('\n\n---\n**Market Line (DraftKings):** The books have Yankees at -150 (60% implied). ParlayKings and the market are roughly aligned.');
check('parse-new-noother: winner parsed', p && p.winnerPrice === -150 && p.winnerImplied === 60);
check('parse-new-noother: other empty', p && p.otherName === '' && p.otherPrice === null);

// ---- parser: legacy format still works ----
p = parseOpeningLineFromText('\n\n---\n**Market Line (DraftKings):** Yankees -150 (60% implied) vs Red Sox +130 (43% implied) \u2014 ParlayKings sees **+10% edge** over the market.');
check('parse-legacy: still parses', p && p.winnerPrice === -150 && p.winnerImplied === 60 && p.otherName === 'Red Sox' && p.otherPrice === 130);
check('parse-none: null on garbage', parseOpeningLineFromText('no market line here') === null);

// ---- line movement ----
const pick = { winner: 'Yankees', confidence: 70, matchup: 'Yankees vs Red Sox', league: 'MLB' };
const ff = { winner: '50/50', confidence: 50, matchup: 'Fighter A vs Fighter B', league: 'UFC' };

out = buildLineMovementComment(
  { bookmakerTitle: 'DK', winnerPrice: -150, winnerImplied: 60 },
  { bookmakerTitle: 'DK', winnerPrice: -150, winnerImplied: 60 }, pick);
check('lm-steady: kicker intact', out.startsWith('\n\n---\n**Line movement:**'));
check('lm-steady: prose + numbers', out.includes("hasn't budged") && out.includes('-150') && out.includes('60% implied') && out.includes('DK'));
noSam(out, 'lm-steady');

out = buildLineMovementComment(
  { bookmakerTitle: 'DK', winnerPrice: -130, winnerImplied: 57 },
  { bookmakerTitle: 'DK', winnerPrice: -170, winnerImplied: 63 }, pick);
check('lm-moved: direction + both prices', out.includes('toward') && out.includes('-130') && out.includes('57% implied') && out.includes('-170') && out.includes('63% implied'));
check('lm-moved: notable gloss', out.includes("grown notably more confident"));
noSam(out, 'lm-moved');

out = buildLineMovementComment(
  { bookmakerTitle: 'DK', winnerPrice: -170, winnerImplied: 63 },
  { bookmakerTitle: 'DK', winnerPrice: -130, winnerImplied: 57 }, pick);
check('lm-moved-away: direction + cooled gloss', out.includes('away from') && out.includes("cooled on this pick"));
noSam(out, 'lm-moved-away');

out = buildLineMovementComment(
  { bookmakerTitle: 'DK', winnerPrice: -110, winnerImplied: 52 },
  { bookmakerTitle: 'DK', winnerPrice: -110, winnerImplied: 52 }, ff);
check('lm-ff-steady: 50/50 read kept', out.includes("ParlayKings' read is still 50/50") && out.includes('-110'));

out = buildLineMovementComment(
  { bookmakerTitle: 'DK', winnerPrice: -110, winnerImplied: 52 },
  { bookmakerTitle: 'DK', winnerPrice: -125, winnerImplied: 56 }, ff);
check('lm-ff-moved: movement + 50/50 read', out.includes('going from -110 (52% implied) to -125 (56% implied)') && out.includes("ParlayKings' read is still 50/50"));

// ---- rule 3 voice directive ----
check('rule3: column-voice directive present', src.includes('stats-heavy sports columnist'));
check('rule3: no label-colon fragments rule', src.includes('never as label-colon fragments'));
check('rule3: four-part structure intact', src.includes('(a) the matchup setup') && src.includes('(d) then the tool-computed win-percentage split'));

console.log(`writeup-column-voice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
