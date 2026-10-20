// Billing regression tests (2026-10-02): Premium runs on Stripe Checkout in
// subscription mode ($25/month auto-renew); packs stay one-time purchases.
// Tests the REAL bundle code extracted from ../src/index.js (never a copy).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name); }
}

// --- tier config: premium is a monthly recurring subscription ---
const tierBlock = src.match(/var CREDIT_TIERS = \{[\s\S]*?\n\};/);
check('CREDIT_TIERS found', !!tierBlock);
const tiers = tierBlock[0];
check('premium tier has recurring month', /premium:\s*\{[^}]*recurring:\s*"month"/.test(tiers));
check('premium tier is $25', /premium:\s*\{[^}]*amountCents:\s*2500/.test(tiers));
check('packs have no recurring flag', !/^\s*"(5|10)":\s*\{[^}]*recurring/m.test(tiers));

// --- checkout session creation branches on recurring ---
const fnStart = src.indexOf('async function createStripeCheckoutSession(');
check('createStripeCheckoutSession exists', fnStart >= 0);
const fnBody = src.slice(fnStart, fnStart + 4000);
check('subscription mode for recurring tiers', /mode",\s*isRecurring\s*\?\s*"subscription"\s*:\s*"payment"/.test(fnBody));
check('recurring interval param for subscription tiers', /recurring\]\[interval\]",\s*tierConfig\.recurring/.test(fnBody));
check('subscription_data metadata carries tier (not payment_intent_data)', /subscription_data\[metadata\]\[tier\]/.test(fnBody));
check('payment_intent_data only in the one-time branch', /else\s*\{\s*\n?\s*params\.append\("payment_intent_data\[metadata\]\[tier\]"/.test(fnBody));

// --- success-return path reads the subscription period end ---
const fulStart = src.indexOf('async function fulfillStripeCheckoutSession(');
check('fulfillStripeCheckoutSession exists', fulStart >= 0);
const fulBody = src.slice(fulStart, fulStart + 2000);
check('fulfillment fetches subscription period end', /mode === "subscription"[\s\S]{0,400}current_period_end/.test(fulBody));
check('fulfillment passes periodEndUnix to unlock', /periodEndUnix\s*\n?\s*\}/.test(fulBody));

// --- webhook renewal path extends access from invoice period end ---
const whStart = src.indexOf('event.type === "invoice.paid"');
check('invoice.paid webhook handler exists', whStart >= 0);
const whBody = src.slice(whStart, whStart + 1500);
check('renewal invoices extend from period end', /periodEndUnix/.test(whBody) && /applyStripeUnlockIdempotent/.test(whBody));

// --- renewal is disclosed plainly in customer copy ---
check('paywall discloses auto-renew', /renews automatically, cancel anytime/.test(src));
check('FAQ discloses monthly auto-renew + cancel', /\$25 per month, renews automatically until cancelled; cancel anytime/.test(src));
check('no stale one-time premium copy', !/go unlimited for 30 days with Premium/.test(src));
check('changelog records the auto-renew conversion', /TRUE AUTO-RENEW PREMIUM/.test(src));

console.log(`billing-subscription: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
