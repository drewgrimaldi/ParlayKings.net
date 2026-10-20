// Market info block tests (2026-10-19).
//
// Drew's order: the market price is information for the model BEFORE it
// decides — never an anchor, never an override. buildMarketInfoBlock
// reads the matchup out of the question, fetches the Polymarket price,
// and shows it only when the price is liquidity-qualified (a real
// market, not a thin quote). No match, no market, unqualified, or any
// failure -> "" and the model decides on everything else it has.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/index.js', 'utf8');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + label); }
}

function extractFn(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start), depth = 0;
  let quote = null, lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

// Stubs the block's free variables resolve against (direct eval scope).
let snapBehavior = async () => null;
let fetchPolymarketSnap = async (env, probe) => snapBehavior(probe);
let todayET = () => '2026-10-19';
eval(src.match(/const POLYMARKET_SERIES_BY_LEAGUE[^;]+;/)[0].replace('const POLYMARKET_SERIES_BY_LEAGUE', 'globalThis.POLYMARKET_SERIES_BY_LEAGUE'));
eval(extractFn('extractMatchupHint'));
eval(extractFn('buildMarketInfoBlock'));

(async () => {
  const QUALIFIED = { winnerImplied: 62, otherImplied: 38, otherName: 'Miami Dolphins', anchorQualified: true };

  snapBehavior = async () => QUALIFIED;
  const block = await buildMarketInfoBlock({}, 'Buffalo Bills vs Miami Dolphins NFL', null);
  check('qualified price becomes a MARKET block', block.includes('MARKET (hidden context'));
  check('block names both sides with their implied prices', block.includes('Buffalo Bills 62% implied') && block.includes('Miami Dolphins 38% implied'));
  check('block frames the price as the model\'s to weigh', block.includes('the pick is yours'));
  check('block never uses anchor language', !/anchor/i.test(block));

  snapBehavior = async () => ({ ...QUALIFIED, anchorQualified: false });
  check('unqualified (thin) price is not shown', (await buildMarketInfoBlock({}, 'Buffalo Bills vs Miami Dolphins NFL', null)) === '');

  snapBehavior = async () => null;
  check('no market -> empty block', (await buildMarketInfoBlock({}, 'Buffalo Bills vs Miami Dolphins NFL', null)) === '');
  check('no matchup in the question -> empty block', (await buildMarketInfoBlock({}, 'how is the weather looking', null)) === '');

  // League not named in the question: probe leagues until one matches.
  const probed = [];
  snapBehavior = async (probe) => { probed.push(probe.league); return probe.league === 'NHL' ? QUALIFIED : null; };
  const nhlBlock = await buildMarketInfoBlock({}, 'Pittsburgh Penguins vs Utah Mammoth', null);
  check('league-less question still finds its market', nhlBlock.includes('Pittsburgh Penguins 62% implied'));
  check('probing stops at the matching league', probed[probed.length - 1] === 'NHL' && probed.length <= 3);

  // The slate date hint is passed through to the fetch.
  let seenDate = null;
  snapBehavior = async (probe) => { seenDate = probe.eventDate; return QUALIFIED; };
  await buildMarketInfoBlock({}, 'Buffalo Bills vs Miami Dolphins NFL', '2026-10-25');
  check('date hint reaches the snapshot fetch', seenDate === '2026-10-25');

  // Wiring: the chat handler builds the block and merges it into context.
  check('handler calls buildMarketInfoBlock', src.includes('marketBlock = await buildMarketInfoBlock(env, message, isSlateRun ? slateEventDate : null)'));
  check('handler merges the block into the model context', src.includes('const contextText = [trackRecord, marketBlock].filter(Boolean).join('));

  console.log(`market-info-block: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERROR: ' + e.message); process.exit(1); });
