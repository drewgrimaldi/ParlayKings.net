// Access-control regression tests (2026-10-02): premium gating for predictions,
// /stats, and the replica API, plus the explicit not-a-gambling-site positioning.
// Tests the REAL bundle code extracted from ../src/index.js (never a copy).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('function ' + name + '(');
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

function extractVar(name) {
  const m = src.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*[^;]+;'));
  if (!m) throw new Error('var missing from bundle: ' + name);
  return m[0];
}

eval(extract('todayET'));
eval(extract('hasSportsSiteAccess'));
eval(extractVar('FREE_PREDICTIONS_PER_DAY'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name); }
}

const today = todayET();
const yesterday = (() => { const d = new Date(todayET() + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
const tomorrow = (() => { const d = new Date(todayET() + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

// --- three free predictions per day (Drew's order 2026-10-02) ---
check('FREE_PREDICTIONS_PER_DAY is 3', FREE_PREDICTIONS_PER_DAY === 3);

// --- hasSportsSiteAccess: denials ---
check('null row denied', hasSportsSiteAccess(null) === false);
check('undefined row denied', hasSportsSiteAccess(undefined) === false);
check('unpaid account denied', hasSportsSiteAccess({ username: 'somebody' }) === false);
check('expired premium denied', hasSportsSiteAccess({ username: 'somebody', premium_until: yesterday }) === false);

// --- hasSportsSiteAccess: grants ---
check('active premium granted', hasSportsSiteAccess({ username: 'somebody', premium_until: tomorrow }) === true);
check('premium expiring today granted', hasSportsSiteAccess({ username: 'somebody', premium_until: today }) === true);
check('lifetime granted', hasSportsSiteAccess({ username: 'somebody', lifetime_access: true }) === true);
check('drewgrimaldi privileged', hasSportsSiteAccess({ username: 'drewgrimaldi' }) === true);
check('grimillionaire privileged', hasSportsSiteAccess({ username: 'Grimillionaire' }) === true);

// --- replica API gate: source audit ---
const replicaAnchor = 'url.pathname === "/api/bets-replica.json" || url.pathname === "/api/bets-replica.csv"';
const replicaIdx = src.indexOf(replicaAnchor);
if (replicaIdx < 0) throw new Error('replica handler missing from bundle');
const replicaBlock = src.slice(replicaIdx, replicaIdx + 1200);
check('replica reads key from X-Replica-Key header', replicaBlock.includes('request.headers.get("x-replica-key")'));
check('replica compares against REPLICA_SYNC_KEY', replicaBlock.includes('env.REPLICA_SYNC_KEY') && replicaBlock.includes('=== env.REPLICA_SYNC_KEY'));
check('replica denies unauthenticated with 403', replicaBlock.includes('status: 403') && replicaBlock.includes('Premium required'));
check('replica allows premium sessions', replicaBlock.includes('hasSportsSiteAccess(replicaBettor)'));
check('replica route does not accept a query-string key', !replicaBlock.includes('searchParams.get("key")') && !replicaBlock.includes("searchParams.get('key')"));

// --- /stats gate: source audit ---
const statsIdx = src.indexOf('url.pathname === "/stats"');
const statsBlock = src.slice(statsIdx, statsIdx + 900);
check('/stats redirects logged-out users to /login', statsBlock.includes('/login?redirect='));
check('/stats checks hasSportsSiteAccess', statsBlock.includes('hasSportsSiteAccess(statsBettor)'));
check('/stats gate copy does not promise packs unlock the record page',
  src.includes('Prediction packs unlock chat predictions only and do not include the record page'));

// --- positioning + disclaimers ---
check('footer disclaimer is explicit (no wagers, no payouts)',
  src.includes('We do not take wagers and we do not pay out winnings'));
check('Stripe checkout carries the product description with disclaimer',
  src.includes('product_data][description]') && src.includes('no wagers are taken and no winnings are paid out'));
check('premium framed as podcast subscription + sports analysis',
  src.includes('Drew Grimaldi Podcast subscription + full sports analysis'));
check('FAQ carries the premium framing',
  src.includes('What is ParlayKings Premium?'));

// --- sportsbook drawer kept (Drew's 2026-10-02 call) ---
check('sportsbook drawer still present', src.includes('function sportsbookDrawerHtml('));

console.log(`access-control: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
