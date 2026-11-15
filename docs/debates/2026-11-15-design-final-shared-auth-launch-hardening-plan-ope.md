# Debate: design-final: shared auth launch hardening plan (open redirect, login CSRF, revocation refresh)

- Id: 2026-11-15-design-final-shared-auth-launch-hardening-plan-ope
- Opened: 2026-11-15T14:23:30.424Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

The plan at /var/www/suite/docs/superpowers/plans/2026-11-15-auth-launch-hardening.md (a different repo from the one you start in; read it by absolute path) implements findings 2, 3 and 6 from our agreed security debate (/var/www/signal/docs/debates/2026-11-15-code-review-and-security-audit-signal-security-aut.md). The relevant code is /var/www/suite/shared/auth-client (handlers/launch.js, middleware.js, handlers/heartbeat.js, lib/hub-api.js, lib/sessions-db.js, lib/cookies.js) and /var/www/suite/hub (routes/launch.js, routes/api-sessions.js, routes/magic.js, views/dashboard.eta). Four apps load the client: Signal, Retrospective, Scrum Poker and RAID. Do NOT read /var/www/suite/hub/data, any .env, or any *.db file.

Key decisions I want challenged:
1. Login CSRF: the app accepts a launch only when a `state` param matches a 120-second HttpOnly SameSite=Lax cookie (Path=/auth/launch) that the app set itself. Hub-initiated launches (dashboard tiles POST /launch/:app; magic links via /launch/:app?return_to) arrive without state. The app does NOT exchange their token; it sets a fresh state cookie and restarts via ${hub}/launch/<app>?state=…, which runs from the browser's own hub session (requireSession). The hub only passes a well-formed state through. I believe this defeats session substitution with a single extra hop and no app-side route changes.
2. Loop safety: a stateless arrival while a state cookie exists gets one 400 and a cleared cookie, never a second restart. So an old hub that drops state fails closed rather than looping. The cost is that one stale cookie (an attempt abandoned within 120 s) produces one 400.
3. Revocation: rather than deleting central sessions on membership or entitlement change, the heartbeat returns current entitlement, teams and company for the calling app, and the client overwrites its stored copy on every successful heartbeat (at most every cacheTtlMs = 60 s). An old hub's bare {ok:true} leaves context untouched, so the deploy order is hub first.
4. Open redirect: a single safeReturnPath helper requires an absolute URL with matching host, a pathname with exactly one leading slash, and no backslash; otherwise '/'.

Please check: whether the state design actually stops the attack (including a top-level POST, and an attacker pre-setting a cookie on a sibling subdomain when cookieDomain is shared); whether SameSite=Lax cookies survive the cross-site redirect chain (hub → app); the magic-link-in-another-browser path; whether a 60 s refresh window is acceptable for revocation, or removal should also delete central sessions; and any gap in the tests or the Review Focus.

## Round 1/3 — ChatGPT: OBJECT

The restart approach is sound for ordinary external launch links, but two blockers and several test gaps prevent approval.

1. The proposed Domain state cookie permits session substitution. The plan’s line 18 copies cookieDomain. An attacker controlling evil.sprintsignal.uk can plant signal_session_state=S with Domain=sprintsignal.uk and Path=/auth/launch, then navigate the victim to /auth/launch?token=ATTACKER_TOKEN&state=S. Both values match, so Task 4 exchanges the attacker’s token without restarting through the victim’s Hub session. HttpOnly and timingSafeEqual do not establish who issued the cookie. Use a __Host- prefixed state cookie with Secure, Path=/ and no Domain, regardless of cookieDomain; merely omitting Domain without the prefix still permits cookie tossing. Add an actual sibling-domain browser test. This is the [cookie-injection weakness OWASP describes](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#naive-double-submit-cookie-pattern-discouraged).

2. Task 3 omits a heartbeat consumer. shared/auth-client/lib/verify-session.js:30–39 compares results with strings. After the proposed object-return change, even {status:'expired',context:null} falls into grace and returns the old authorization context. I reproduced that with the existing function. Successful heartbeats would likewise neither refresh nor touch its session. Retrospective server.js:58 and Scrum Poker lib/wsServer.js:25 use this function for WebSocket authentication. Update it alongside requireAuth and handleHeartbeat, preferably sharing validation logic, and test actual object results for success, revocation, expiration and outage.

3. Cookie clearing needs an explicit implementation requirement. lib/cookies.js:20 and :26 both replace Set-Cookie. Calling a state-cookie clearer followed by the existing session setter loses the deletion; I reproduced that overwrite. Require appending separate headers, and assert that successful launch both creates the session cookie and deletes the state cookie. Otherwise the retained state causes the next dashboard launch to fail.

The other decisions are reasonable with qualifications. Top-level GET redirects carry explicit SameSite=Lax cookies, including after a POST becomes GET; the relevant rule applies to the current redirect hop ([cookie specification §5.6.7.1](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-22#section-5.6.7.1)). Hub middleware/csrf.js:54–69 also rejects an attacker-origin top-level POST, and Signal exposes launch through GET. A magic link opened in browser B should work because routes/magic.js creates B’s Hub session before the app initiates its fresh state transaction. Add browser tests for dashboard POST → app → Hub → app, fresh-browser magic links, hostile POSTs and the old-Hub failure sequence; Supertest cannot establish browser cookie behavior.

Refreshing authorization is preferable to deleting every central session on membership changes. Deletion still cannot immediately invalidate cached app authorization. However, describe the bound accurately: factory.js:25–26 permits approximately 60 seconds under healthy validation and six minutes during failure with the retained grace policy. Existing WebSockets also retain company context (Retrospective server.js:82, :969), so heartbeat refresh alone does not bound their access. Revalidate/disconnect those connections or explicitly leave that as an outstanding limitation; do not claim suite-wide 60-second revocation.

The safeReturnPath design closes the demonstrated scheme-relative redirect when checks run on the parsed pathname and the emitted path is never decoded afterward. The one-400 stale-cookie policy is also acceptable once deletion is reliable.

Verification: independently inspected Suite c2627ac and Signal d25fa20. Auth-client npm test passed; selected Hub tests were blocked by sandbox listen EPERM. No files changed, no commit or push, and no project server running.

## Round 2/3 — Claude

I concede points 1, 2, 3 and the revocation bound, and have amended the plan. Please re-read /var/www/suite/docs/superpowers/plans/2026-11-15-auth-launch-hardening.md. One point I rebut in part: the browser tests.

1. Cookie tossing: agreed, copying cookieDomain defeated the design. The state cookie is now `__Host-${cookieName}_state` with Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age=120, and never a Domain, regardless of cookieDomain. The Task 4 test asserts the prefix, every attribute, and that there is no Domain even when the client is built with cookieDomain set.

2. verify-session: confirmed. lib/verify-session.js compares strings, and the object return would have fallen into grace on 'expired'. Task 3 now extracts lib/validate-session.js, a single cache/heartbeat/grace decision that requireAuth and verifySession both delegate to. That replaces the hand-synced copy the file's own NOTE warns about. New tests cover verifySession on revocation, expiry (null, with the row deleted), and an outage both within and past grace.

3. Set-Cookie overwrite: confirmed. Both helpers use setHeader. A Global Constraint now requires every cookie write to append, and the matching-state test asserts two Set-Cookie headers: the session cookie, and the state cookie with Max-Age=0.

4. Revocation bound: restated accurately. It is about 60 s while the hub is reachable and up to cacheTtlMs + graceMs (about 6 min) while it is not. Already-open WebSocket connections in Retrospective and Scrum Poker keep their context until they reconnect. That is recorded as an explicit limitation for a follow-up, not claimed as covered.

Partial rebuttal on browser tests: I agree supertest cannot prove browser cookie semantics. But Lax on top-level redirects and __Host- enforcement are standardised browser behaviour, and an automated cross-site test would need two HTTPS hostnames plus a hub and an app running with real cookies, infrastructure the suite does not have. What can go wrong on our side is the headers we emit and the decision logic, and both are now pinned. For the browser half I have added a post-deploy manual smoke check run in real browsers. It covers a dashboard tile through the extra hop, a magic link opened in a different browser, a stolen token URL opened in a second browser (which must show the 400), the stale-tab single 400, and member removal taking effect within about 60 s. Is a pinned header contract plus that manual check sufficient, or do you hold that automated browser coverage blocks approval?

## Round 2/3 — ChatGPT: AGREE

I reread the amended plan and the current consumers. The revisions address the substantive blockers: host-prefixed state cookies, shared validation covering verifySession, appended cookie headers, and accurate revocation limits. Automated cross-site browser coverage need not block this design; pinned server contracts plus documented real-browser smoke checks are proportionate here. Record those smoke results before declaring the rollout verified.

Two test clarifications matter:

1. Smoke check 3 must distinguish callbacks. Copying the restarted callback containing state into browser B must produce 400. Copying the initial stateless callback should restart authentication through B’s own Hub session; it must never authenticate B as A, but need not produce 400. Task 4 explicitly requires that restart.

2. Assert the __Host- cookie attributes on deletion too: Secure, Path=/ and no Domain, alongside Max-Age=0. The current lib/cookies.js clearSessionCookie omits Secure, so reusing it unchanged would cause browsers to reject deletion of the prefixed cookie. This follows the amended Global Constraint, but the test should enforce it.

I accept authorization refresh without deleting central sessions for ordinary membership changes. The documented scope is HTTP requests and new WebSocket connections, with approximately 60-second freshness during successful validation and up to six minutes during failures. Already-open sockets remain an explicit follow-up.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Validate the parsed return path before redirecting. Accept token exchange only when state matches a short-lived __Host- cookie; otherwise reject mismatches or restart stateless launches through the browser’s own Hub session without exchanging the supplied token. Append session and state-deletion cookies with valid attributes. Refresh authorization through shared validation used by HTTP middleware and WebSocket session checks, retaining the documented cache/grace policy. Deploy Hub first, run regression tests, and complete the clarified manual browser checks; track existing WebSocket revocation separately.

