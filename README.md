# ai worker (pulled from Cloudflare)

## Recap double-count fixed (dedupe by record ID)

Both providers resolve to one Airtable base, so the recap fetched it twice and doubled every line. Graded records are now deduped by record ID. Covered by `tests/alerts.test.js` 59/59; nothing else in alert logic changed.

## Nav drawer trimmed, GRIMALDI.TV under Trivia

Hamburger podcast stack is HOME + EPISODES only (live broadcast, photo gallery, blog, merch, clip vault removed) in both drawer copies, and GRIMALDI.TV sits under TRIVIA on every host. New `tests/nav-links.test.js` 29/29.

## Notifications only announce fresh jobs

Any push ticket made the phone re-announce the latest finished job, so alert pushes arrived wearing a stale "prediction ready" banner. The service worker now only announces jobs done within 15 minutes, and shows nothing when there is no fresh job and no pending alerts. Wiring checks in `tests/alerts.test.js` 53/53.

## Notification taps render once, tapped runs keep a watch window

Tapping a "prediction ready" notification could type the reply twice: the startup sweep and the tap fetch raced (a tap can also arrive twice — worker message plus ?job= URL) with no in-flight guard. All render paths are now single-flight, the sweep skips the tapped job, repeat taps are no-ops, failed taps stay retryable, and tapping a still-running job adopts a 10-minute watch window. Extended `tests/bg-resume.test.js` 18/18 (reopen-once, double-tap-once, pending-tap watch), full suite 539/539.

## SAM 1.6: pick alerts, nightly recaps, line-move intel — one dispatcher

Every alert flows through a single choke point (dispatchAlert in src/index.js): per-user prefs, quiet hours, and rate caps are enforced before any push goes out. Three alert types: high-edge pick alerts fire the moment SAM logs a pick above your minimum confidence (hooked off the hot path via ctx.waitUntil(dispatchHighEdgeAlert(...))); a grading recap lands nightly at 9 PM ET (runNightlyRecaps, once-per-day marker); line-movement intel fires when a logged pick's line moves 25+ cents overall or 15+ cents within the hour, with a 6-hour cooldown per pick (checkRecordMovement). Alerts default off until enabled in settings — per-league toggles, 50-100 confidence floor, quiet hours included. Capped at 12 alerts a day with 24-hour dedupe; push tickets stay payload-less with rich content pulled from /api/alerts/pending. New tests/alerts.test.js 51/51.

## Deployed 2026-09-16 as version `d8dc8873`: user profiles (notify prefs, settings, avatars)

KV profile record becomes a full user profile: notification prefs (master toggle, per-league toggles, 50-100 min confidence, quiet hours) plus settings with display name and R2-backed avatar. New drawer profile UI with prefs form and picture upload (client 512px downscale; server MIME magic check, 2 MB cap, header dimension parsing). Degrades gracefully until R2 enabled. New `tests/profile.test.js` 55/55, full suite 364/364. Prefs only, no sending logic.

## Deployed 2026-09-16 as version `af8ef71e`: pin chats and picks

Chat history now pins entire chats and individual games/picks, freely combined. Per-user KV profile record (profile:<user-or-guest-ns>) with reserved notify/settings sections for later features; no notification logic. Turn picks persist at save time; pinned chats get their own history section with toggles, saved pick rows carry a pin button, deleting a chat prunes its pins. Caps: 100 chat pins, 200 pick pins. New `tests/pins.test.js` 49/49, full suite 309/309.

## Deployed 2026-09-15 as version `c13de2ed`: tennis coin flips stand, capped at 3 a day

Genuinely even tennis (model calls 50/50, or sim split within 2 points)
now stands as an honest 50/50 — logged, grades Push — instead of being
forced onto a side. Daily KV counter (ET day, 48h TTL) caps stands at 3;
past the cap the request is declined as too-close-to-call with nothing
logged and no credit deducted. Other leagues untouched; counter failures
fail open to standing. New `tests/tennis-fiftyfifty-cap.test.js` 31/31,
full suite 260/260.

## Deployed 2026-09-15 as version `920f514f`: Bayesian band calibration back on (with changelog entry)

The per-band calibration fit/apply helpers stayed in the bundle but the
call-site block had been replaced with `void finalCalibrationParams`
(calibration off). Restored the block after sim lock: fitted bands may pull
the sim-locked number DOWN toward the band's historical hit rate, never
above the sim; visible reply text rewritten to match the logged value.
`tests/band-calibration.test.js` 12/12 (overconfident 60-69 band pulls 64
to 53, thin 80-89 band stays near raw), sim-lock structural guard updated
to allow the sanctioned down-only block, full suite 229/229.

## Deployed 2026-09-14 as version `c115d379`: saved chats keep thumbs + share

Opening a saved conversation rendered bare bubbles — the restore path never
called the action builder, so no copy/thumbs/share/speak/second-opinion.
One-line fix in openConvo routes every revived reply through the same row
as live messages (provider falls back for old turns). New
`tests/saved-chat-actions.test.js` 9/9, full suite 215/215.

## Deployed 2026-09-14 as version `2fb7a2a8`: two-state gold login button

Reverted the unconditional Login link — it showed a login prompt to
logged-in users. Footer now renders session state: guests get a solid gold
LOGIN button, authed users get a gold-outline ✓ username button. 206/206
green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `863b4cd5`: unconditional Login link in drawer

Drawer footer is a plain Login link, always, for everyone — state text and
conditional branches removed entirely. 206/206 green, `node --check` +
dry-run pass.

## Deployed 2026-09-14 as version `3b02399b`: plain Login / Logged in drawer text

Ripped out the green checkmark chip — overbuilt and wrong. Drawer footer
now shows a plain Login link for guests and plain "Logged in" text when
authed, in small gold mono matching the footer. No pills, no checkmarks.
206/206 green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `562548d9`: login status chip in Chat History footer

Drawer footer gains an account chip next to the bell: signed-in users see
a green confirmed `✓ username` (escaped, truncated, full name on hover);
guests see a gold Sign in pill to /login. Username comes from the existing
session object; no new routes or state. Guest branch verified on the live
homepage. 206/206 green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `d60a2f8f`: self-serve password reset

Forgot-password link on the login page; emailed single-use reset links
(1-hour TTL) from noreply@parlaykings.net via the new EMAIL send_email
binding (email sending enabled for parlaykings.net); new-password page with
min-8 + confirm match. Identical response whether or not the account exists,
3/hour throttle, tokens single-use, PBKDF2 + existing Supabase PATCH path.
/forgot + /reset added to robots Disallow. `tests/password-reset.test.js`
9/9, full suite 206/206.

## Deployed 2026-09-14 as version `360850f6`: Login always visible in chat footer

The footer Login link shipped session-gated, so signed-in Drew never saw
it. Now unconditional: About, Stats, Version Notes, GRIMALDI.TV, Login for
everyone. One-line change; 197/197 green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `72dc32d8`: logo-type drawer title

Drawer title rebuilt as a two-line lockup in the logo's voice: white
beveled "Parlay Kings" over glowing gold "Chat History", Oswald 800 with
dark outline + cut shadow. Marker bar removed (lockup carries it). CSS +
markup spans only; logic untouched. 197/197 green, `node --check` + dry-run
pass.

## Deployed 2026-09-14 as version `e127025b`: Oswald title + footer Login link

Drawer title now set in Oswald 800 at 21px (the brand's bold condensed
sports face, already loaded on the page) with cut shadow — no more thin
mono. Footer under the chat bar gains Login for signed-out visitors
(About, Stats, Version Notes, GRIMALDI.TV unchanged; hidden when authed).
CSS + one conditional link; logic untouched. 197/197 green, `node --check`
+ dry-run pass.

## Deployed 2026-09-14 as version `2c6bdf14`: "Parlay Kings Chat History" header glow-up

Drawer title renamed to Parlay Kings Chat History, set at 16px extrabold
with a subtle cut shadow; gold marker bar upgraded to the coin gradient with
a soft glow; header sits on a faint gold band. CSS-only, logic untouched.
197/197 green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `fbbbdbc5`: history drawer redesign + dollar toggle

Full drawer restyle, same gold identity: 15px extrabold title with gold
marker bar, roomier header, conversation rows as bordered cards (gold hover,
gold active ring instead of the old inset tick), date pills, gold thin
scrollbar, finished footer. Hamburger toggle replaced with a bold `$` on the
gold coin button. No JS/logic touched — CSS + one markup span only. `npm test`
197/197 green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `242b2820`: professional history drawer header

The "Parlay Kings History" title was 11px unweighted mono caps with wide
tracking — the skinny look. Now 14px bold with tighter tracking, roomier
header padding, stronger gold rule. Drawer body, rows, bell, and notification
code untouched. `npm test` green, `node --check` + dry-run pass.

## Deployed 2026-09-14 as version `650354b7`: postmortems say why, not just "oops"

Losses at 72% used to tag `high_confidence_miss` and losses at 52% tagged
`coinflip_miss` — the scoreboard restated, no cause. The grader now reads
the final score (`parseScoreMargin` on the ESPN summary, Notes grade line
as fallback) with per-league bands (NFL/CFB close 8 rout 17, MLB 2/6,
NBA/CBB 6/15, NHL 1/4, soccer 1/3): blowouts tag `rout` (sim misevaluated
strength), one-score losses tag `one_score` (variance, process intact),
fading the market 5%+ and losing tags `market_called_it`. `coinflip_miss` /
`favorite_miss` are fallback-only when nothing causal fires;
`high_confidence_miss` untouched so the overlap guard, efficacy tracking,
and conservatism pull keep their input. Autopsy lines now read e.g.
`POSTMORTEM: high_confidence_miss, rout — Stars 72% — final margin 21 —
sim misevaluated strength, not variance`. New tags added to
`POSTMORTEM_TAGS` allowlist + LOSS PATTERNS legend so history counting
picks them up. `tests/postmortem-upgrade.test.js` 54/54 (was 29/29), full
suite 197/197.

## Re-pulled 2026-09-14 (live version `276f473c`, 100% traffic, deployed 2026-09-13T20:32:51Z)

`worker.js` 2,580,634 bytes raw multipart / live `index.js` part 2,580,451
chars extracted (`node --check` passes). Settings identical to local
(`compatibility_date 2026-08-04`, same bindings). Prior files kept as
`worker./settings./src/index.20260914-1934.bak`.
Note: `src/index.js` intentionally kept as the local deploy source, NOT
replaced with the live bundle this time — the live build wraps one arrow
fn in `__name(...)` (bundler-version artifact), which breaks the
`postmortem-upgrade` extract-and-eval harness (`__name is not defined`).
Function logic verified identical (all feature markers present, same
CHANGELOG 1.6 text). Full suite 172/172, `node --check` + dry-run pass
(2519.97 KiB).

## Deployed 2026-09-13 as version `276f473c`: postmortem upgrade — overlap guard + efficacy auto-retire

Two upgrades from the review. (1) Calibration overlap guard: sim-side
conservatism pull softens 0.9 to 0.95 (labeled) when band calibration is
already correcting high bands down 5+ points — no more double-counting.
(2) Efficacy tracking: adjustment activations recorded per league in KV with
tag baselines; after 8+ further losses the rate is re-measured — halved keeps
it, flat retires it as ineffective, over-hitting high bands retires it as
overcorrecting. Retirements hold 30 days with reasons in the sim note.
`tests/postmortem-upgrade.test.js` 29/29, full suite 172/172.

## Deployed 2026-09-13 as version `ff91705a`: tap-to-open resume

Tapping a ready-notification opened `?job=` on a fresh page (new chat ID, empty
seen-maps): the finished job matched nothing, and a stale storage read showing
"pending" meant the page never started watching — eternal dots until reload.
The page now adopts the tapped job's chat, renders finished jobs into it, and
keeps polling on stale reads; every completed background render clears the
dots. `tests/bg-resume.test.js` 11/11, full suite 143/143.

## Deployed 2026-09-13 as version `df89d56e`: same code as `0da3f3e1` plus the bundle CHANGELOG entry for it (notes-only deploy, verified 100%)

## Deployed 2026-09-13 as version `0da3f3e1`: notify jobs start on send, cron only backstops

Armed-bell sends used to sit pending until the minute cron noticed them (up
to 60s dead wait). `POST /api/jobs` now runs that job object immediately via
`ctx.waitUntil(runBgJob(...))` — no re-list, so no KV-visibility race — and
the push still fires the second it finishes. The minute cron keeps grading +
replica dump and retries only stuck runs (a "running" job older than 6 min,
down from 15). `tests/bg-backstop.test.js` 7/7 (oldest-first, no double-run,
stuck retried, done never rerun), full suite 132/132. Bell, push, SW, jobs
routes, and the client polling loop untouched.

## Deployed 2026-09-13 as version `5b6ffb2e`: reasoning bubble survives History + cached answers carry a bubble

Opening a saved chat dropped the collapsible "ParlayKings Reasoning" bubble
every time: `saveConvoTurn` never sent `thinking`, `/api/convos/save` never
stored it, and `openConvo` rendered only user/ai bubbles. Now thinking is
saved per turn (foreground + background-job path), and opening a chat
restores each bubble collapsed-by-default in place. Second gap found live:
repeat questions served from cache returned no `thinking` at all, so no
bubble ever rendered on them — cached replies now include a collapsed bubble
with the logged pick facts, honestly labeled (no new model run, no new chain
of thought). Old chats from before today can't get bubbles back: their
chains of thought were never stored anywhere. Bubble behavior itself
unchanged (collapsed by default, click to expand). `renderReasoning` rebuilt
on DOM APIs, whitespace tidying in `tidyReasoningText` (identical display
rules). `tests/reasoning-history.test.js` 30/30, full suite 125/125,
`node --check` + deploy pass. Notification/push/jobs/cron code untouched.
Bundle CHANGELOG also backfilled with yesterday's notify-when-done lineage.

## Re-pulled 2026-09-13 ~13:12 EDT (live version `16fc0960`, 100% traffic, deployed 04:19:47Z)

`worker.js` 2,543,973 bytes raw multipart / `src/index.js` 2,543,656 chars
extracted (`node --check` passes, dry-run 2506.95 KiB, `npm test` 95/95).
Settings diff vs prior pull: +3 secret bindings `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (push-notify lineage); rest identical
(`compatibility_date 2026-08-04`, same KV + browser). Prior files kept as
`worker./src/index./settings.20260913-1712.bak`.

## Deployed 2026-09-12 as version `070fc5f2`: dots survive until the answer renders

Root cause of vanishing dots: the first status check runs before the server
files the job, sees nothing, and used to stop watching + clear the dots.
Now it keeps watching (10-min backstop) and only clears the dots when an
answer actually renders. Stops polling the moment things settle (no 10-min
tail after a render). `tests/bg-poll.test.js` 11/11 locks it. Suite 87/87.
Verified live.

## Deployed 2026-09-12 as version `d33684e0`: bell-off runs zero notification code

Startup history catch-up only runs for browsers that ever used background
(`pk_bg` flag set at enqueue); everyone else skips it entirely. Scratch
probe files removed. Verified live.

## Deployed 2026-09-12 as version `4c1666d1`: dots back + visible armed state

Background runs show the thinking dots again (shown at enqueue, cleared when
nothing is pending; never touches the foreground bubble). Armed bell also
puts a gold ring on the send button so background mode is visible without
opening History. Root-caused the "ignoring me" reports: core `/api/chat`
proven live (answered greeting 200), bell had been left armed so everything
went down the slow silent path. `npm test` green.

## Deployed 2026-09-12 as version `ff21bec5`: bell to drawer footer, silent background

Bell moved out of the chat input row into the History drawer footer next to
the menu hamburger (gold, 50px to match); no settings tab, no change-password.
Background runs are silent now — question appears, answer lands, nothing in
between. Proven end-to-end with throwaway account `bgtest01`: enqueue 200,
cron ran it, `done` in ~70s with reply, turn saved to convo history
(`test-convo-001`, count 1). Verified live: bell in `chats-foot`, absent from
input row.

## Rolled back 2026-09-12 to version `3a476237` (queue build, no push)

The notify-when-done builds (`e09efaab`, `72b19f9c`) broke core chat on
phones (new routes crashed server-side; background jobs never completed).
Live traffic is back on the message-queue build: normal chat + queued
follow-ups, no bell, no background jobs. Push work is shelved, not deleted
(local `src/index.js` still has it). Verified live: bell code absent, queue
code present, homepage 200.

## Deployed 2026-09-12 as version `e09efaab`: notify-when-done background predictions

Bell button next to send (gold when armed, persisted per browser). Armed
sends go to `POST /api/jobs` (sign-in required, 3 pending cap, credit peek
at enqueue) instead of the blocking `/api/chat`; the every-minute cron runs
them through the real pipeline via internal replay (same sim, same `[PICK]`,
same Airtable write, same credit deduction), saves the turn server-side, and
fires a payload-less Web Push ticket. New routes: `/sw.js`, `/api/push-public-key`,
`/api/push-subscribe`, `/api/jobs`, `/api/jobs/mine`, `/api/job`. Secrets added:
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Open page polls every
15s and renders finished jobs; tapped notifications deep-link `/?job=`.
`npm test` 76/76 (`tests/bg-predict.test.js` 38/38: real VAPID sign/verify,
push shape, cron replay, convo save, retention, SW parse). `node --check` +
dry-run pass (2483.17 KiB). Verified live: 100% `e09efaab`, `/sw.js` serves,
public key endpoint returns the key.

## Deployed 2026-09-12 as version `72b19f9c`: fix session crash on jobs/push routes

New routes read `session` before it was created (server 500 `error code:
1101` on `/api/jobs*`, `/api/push-subscribe`), which the phone surfaced as
JSON parse errors. Routes now resolve their own session; client JSON parsing
hardened to never show raw syntax errors. Verified live: signed-out calls
return clean 401 JSON.

## Deployed 2026-09-12 as version `3a476237`: queued follow-ups

While a response is generating, Enter/tap-to-send now queues the typed text
in numbered rows above the input (× cancels one, cap 5 with the box flashing
blue when full) instead of dropping it; each queued message auto-fires FIFO
when the current turn — or a Run-today slate run — finishes. Send button
stays tappable while busy so mobile can queue too. `npm test` 38/38
(`tests/message-queue.test.js` 23/23 drives the REAL `send`/`renderQueue`
extracted from `src/index.js` against a fake DOM; also caught and fixed a
real deadlock where a full queue + leftover input text stalled the flush —
drain passes `send(true)` so the draft is never silently dropped).
`node --check` + dry-run pass (2459.90 KiB). Pre-queue bundle kept in
`worker./src/index./settings.20260913.bak`.

## Re-pulled 2026-09-12 ~22:00 EDT (live version `08560e9b`, 100% traffic, deployed 21:01:47Z)

`worker.js` 2,493,671 bytes raw multipart / `src/index.js` 2,493,488 bytes
extracted (`node --check` passes, dry-run 2457 KiB). Settings semantically
identical to prior pull (`compatibility_date 2026-08-04`, same 22 bindings).
Prior files kept as `worker./src/index./settings.20260913.bak`. Note: the
pre-pull `src/index.js` had uncommitted local staged edits (drawer fixes +
empty-text removal, ~901 bytes over the old raw); those survive only in
`src/index.20260913.bak` — the fresh `src/index.js` is the clean live bundle.

## Deployed 2026-09-12 as version `08560e9b`: wrong-game cache fix — `sameMatchup` compared only sorted last-word nickname keys, so "Michigan State vs Eastern Michigan" and "Michigan vs Washington State" both keyed `michigan|state` and a cached pick for one was served for the other (deterministic, every ask). Now side-by-side (exact/containment per side, both sides, either order); `recordMatchesMessage` routes parsed hints through it. `npm test` 15/15 (`tests/same-matchup.test.js`, tests real extracted functions). No other behavior changed.

## Deployed 2026-09-12 as version `4902425b`: thinking-bubble restore — `thinking` could come back empty (direct answers: no `reasoning_content`, no sim trace), and the client only renders the bubble when it's non-empty, so the bubble looked deleted. Both live loops now finalize thoughts with a fallback line when nothing ran; prediction-turn traces byte-identical, client untouched (full text, collapsible, collapsed by default). Verified live: chit-chat `/api/chat` now returns non-empty `thinking`. No other behavior changed.

## Re-pulled 2026-09-12 ~19:40 UTC (live version `e6b60d09`, 100% traffic, deployed 17:46:01Z)

`worker.js` 2,470,216 bytes / `src/index.js` 2,470,034 bytes (`node --check`
passes). Settings diff vs 12:31 pull: new secret binding
`META_API_KEY_BACKUP` (rest identical, `compatibility_date 2026-08-04`).
Prior files kept as `worker./src/index./settings.20260912-*.bak`.

## Re-pulled 2026-09-12 ~12:31 UTC (live version `e3822c66`, 100% traffic, deployed 05:50:41Z)

`worker.js` 2,447,241 bytes / `src/index.js` 2,447,061 bytes (`node --check`
passes, dry-run 2411 KiB). Settings identical to Sept-11 pull
(`compatibility_date 2026-08-04`, same bindings). Prior files kept as
`worker./src/index./settings.20260912-123113.bak`.

## Deployed 2026-09-12 as version `ecf25266`: added `<meta name="mobile-web-app-capable">` (Apple tag kept). Verified live on ai.drewgrimaldi.workers.dev.

## Deployed 2026-09-12 as version `7f62393a`: chats-toggle hidden while nav drawer open (`body.nav-open .chats-toggle { display: none; }`) so it no longer covers nav links. Verified live.

## Deployed 2026-09-12 as version `704cf022`: Settings tab in chats drawer (Chats | Settings) with account panel (signed-in user, predictions left, Get more / Stats / Sign out). Verified live.

## Deployed 2026-09-12 as version `01b96257`: settings gear button in chats-drawer footer (replaces tabs); settings pane now Voice picker (6 Grok voices for Read aloud, per-customer localStorage) + Change password (`POST /api/change-password`, verifies current, PBKDF2, min 8). Account/Stats links removed. Verified live on all 3 domains.

## Deployed 2026-09-12 as version `fdd96b0b`: full settings removal per Drew (button, pane, styles, logic, endpoint, voice param) — zero remnants verified. Drawer back to chat history + bottom nav hamburger only.

## Deployed 2026-09-12 as version `e6b60d09`: chat history open to everyone — guests get a browser-random namespace (`?guest=`) instead of the login redirect; signed-in flow unchanged. Verified live (guest list 200).

## Current state (deployed 2026-09-12 as version `664a5bb0`, cron and secrets preserved)

## Staged: drawer fixes + empty-text removal (not yet deployed)

- + New hardened (`newChatTap` with inline fallback, focuses input) and
  drawer rows restyled (dividers, active gold bar, muted dates).
- "Ask me anything" removed from the empty state in all 3 places
  (template + both JS fallbacks); empty container kept so message logic
  is untouched. Verified zero occurrences + `node --check` pass.

Live serves: header banner, photo background, share button. Staged locally
on top of the clean eb5317b0 pull and verified (`node --check` + dry-run
pass, upload 2388 KiB): the same three (re-applied after the rollback
wiped them) PLUS the new Chats drawer — gold left-arrow under the
hamburger opening a saved-conversations drawer (KV-backed `/api/convos`
list/load/save/delete, wired into chat send, signed-in only), mirroring
chat.grimaldi.tv. Deliberately NOT included: zoom lock, share menu, picks
history page, manifest changes, voice change.

Re-pulled 2026-09-11 from account `Drewgrimaldi@gmail.com's Account`, worker `ai`
(live version `eb5317b0`, deployed 2026-09-11T00:43:28Z; first pulled 2026-09-10).
Deployed bundle version 1.6 (ParlayKings / Grimaldi TV sports worker).

Back at the clean slate on 2026-09-12: live worker rolled back to
`eb5317b0` at 100% of traffic, local `src/index.js` restored to the
unedited pulled bundle (verified zero remnants, `node --check` passes).
All header banner, zoom-lock, and manifest experiments reverted.

## Header banner, round 3 (deployed 2026-09-12 as version `55725c8a`, cron and secrets preserved; verified live)

## Photo background (deployed 2026-09-12 as version `e0c887d4`, cron and secrets preserved; verified live)

## Share button (staged, not yet deployed)

Small circular gold share button pinned top-right of the homepage header
(stroke SVG icon, no emoji). Uses the native share sheet via
`navigator.share` where supported, falls back to copying the URL with a
brief highlight. `node --check` + dry-run pass.
Deployed 2026-09-12 as `fdd4b1fd` (button only).

## Share menu (deployed 2026-09-12 as version `d965ca9a`, cron and secrets preserved; verified live)

## Share menu removed (deployed 2026-09-12 as version `9f0c9243`, cron and secrets preserved; verified live)

Back to button-only share (native sheet / copy fallback) at Drew's call —
menu HTML, CSS, and JS fully removed (zero remnants, `node --check` passes).
Labeled unconditional history arrow confirmed serving on parlaykings.net.

## Prediction history (deployed 2026-09-12 as version `7d9e42b3`, cron and secrets preserved; verified live)

Gold down-arrow under the homepage footer links (signed-in only) opens new
`GET /history`: the user's own picks from both Airtable bases filtered by
`Bettor Username` (session username, charset-validated), newest first, max
50. Each card shows matchup, result pill (Win/Loss/Push/Pending colors from
/stats), league, model, dates, pick + confidence, the asked question, and an
expandable full response (split from Notes on `FULL_REPLY_MARKER`, escaped).
Logged-out visits redirect to login. `node --check` + dry-run pass.
Arrow is now unconditional (visible to guests too; /history gate sends
them to login) with a small HISTORY label after Drew couldn't find the
bare chevron.

## Speak voice (deployed 2026-09-12 as version `c46e1d5c`, cron and secrets preserved)

`/api/speak` used xAI `voice_id: "orion"` (not in xAI's published lineup:
ara, eve, leo, rex, sal — likely why it sounded rigid). Switched to
`"ara"` (warm) at Drew's pick. `node --check` + dry-run pass.

Share button now opens a small dropdown: "Share link…" (native sheet or
copy with confirmation) and "Add to Home Screen" (reveals 3-step iOS
instructions: Safari toolbar Share → Add to Home Screen → Add). Same
open/close pattern as the predictions menu. `node --check` passes.

## Zoom lock (removed)

Was deployed 2026-09-12 as `2ff1238a`, then removed again in `5b28624d`
at Drew's call — homepage has no zoom restrictions now.

`ParlayKings Background.png` (Desktop, 884x1779) compressed to JPEG q82
(2.3MB -> 229KB), embedded as `BG_BASE64` data-URI. Homepage-only `body`
override replaces the purple radial gradient with the photo (`cover`,
top-centered, dark fallback color kept). Photo's smoky dark center keeps
chat text readable with no overlay. `node --check` + dry-run pass.

Header only, nothing else: `HEADER_BASE64` data-URI, fixed `height`
(190px desktop / 96px under 600px) with `object-fit: cover`, tightened
mobile `.header` padding, `padding-top: env(safe-area-inset-top, 0px)`.
No viewport/zoom-lock changes, no manifest/meta changes.
`node --check` + dry-run pass (upload 2075 KiB).

## Contents

- `src/index.js` (1.68 MB) — deployed compiled bundle (`name="index.js"` part
  of the upload). Cloudflare keeps the built bundle, not your original source,
  so this is minified/bundled output, not the pre-build `src/` tree.
  `node --check` passes.
- `worker.js` (1.68 MB) — raw multipart upload as returned by the
  `GET /accounts/:id/workers/scripts/ai` API (single `index.js` part).
  Kept for reference. Note: the 2026-09-10 pull contained ~64 embedded text
  assets (`*-grimaldi-tv/*.html`, `*.sql`); the Sept-11 upload is a single
  `index.js` part with no embedded assets.
- `settings.json` — live worker settings from
  `GET /accounts/:id/workers/scripts/ai/settings` (`compatibility_date
  2026-08-04`, full binding list). Contains secret/binding *names* only;
  values are NOT downloadable.
- `wrangler.jsonc` — reconstructed config: `compatibility_date 2026-08-04`,
  KV namespace `SAM_BETS` (`de1fea6598a74ff2820fcf4bb930933c`), browser
  binding `BROWSER`.

## Secrets (values are NOT downloadable)

Re-set before deploying from here:

AIRTABLE_API_KEY, BALLDONTLIE_API_KEY, CF_ACCOUNT_ID, FOOTBALL_DATA_ORG_API_KEY,
GEMINI_API_KEY, GEMINI_API_KEY_BACKUP, GROK_API_KEY, GROK_API_KEY_BACKUP,
GROK_API_KEY_BACKUP2, META_API_KEY, ODDS_API_KEY, ODDS_API_KEY_BACKUP,
RAPIDAPI_TENNIS_KEY, SCRAPINGANT_API_KEY, SESSION_SECRET, STRIPE_SECRET_KEY,
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, ZENROWS_API_KEY

```powershell
cd C:\Users\drewg\ai-pulled
wrangler secret put GEMINI_API_KEY
# repeat per secret, or: wrangler secret bulk .secrets.json (file you create, never commit)
```

## Run / deploy

```powershell
cd C:\Users\drewg\ai-pulled
wrangler dev          # local dev (needs secrets for most routes)
wrangler deploy       # overwrites the live `ai` worker — confirm first
```

Note: `node --check src/index.js` passes. `src/index.js` has no
`export default` source map back to original files; for real development,
re-apply changes in the original repo that built this bundle, then redeploy.
