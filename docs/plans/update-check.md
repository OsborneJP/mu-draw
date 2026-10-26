# Check for a new build while the app is open

Asked by Jeff on 2026-10-26: must a student close and restart MU Draw before learning that an update is available, or can the banner appear during normal use?

Today, a student learns that a new build is out only on a fresh load of the app (opening it, or refreshing). A student who keeps the app open through a lab session never sees the update banner until next time. The aim: an open app finds a new build when the student comes back to it, and shows the same banner. Nothing else about updates changes.

## Measured before planning

- **No check after launch.** `web/src/pwa/register.ts` registers the service worker once and never asks the browser to check again. Browsers check `sw.js` by themselves on a navigation (a launch or refresh), and this app never navigates while open.
- **The check is one small request to the app's own base.** `registration.update()` fetches the registration's own `sw.js` (about 2 KB). Apache serves it `no-cache` (docs/server-setup.md). Its precache list holds every other file. If `sw.js` has changed, the browser installs the new build in the background, the same download a launch would start today.
- **A deploy publishes `sw.js` last** (scripts/lib/deploy.sh, phase 4). So a check made during a deploy sees either the old build or the complete new one.
- **workbox-window stops listening after one late update.** vite-plugin-pwa's `registerSW` relies on workbox-window 7.4.1 to notice a new build, and that is what calls `onNeedRefresh` and shows the banner. workbox-window treats a new build found more than 60 s after the page registered (or after it has already seen one) as "external". On the first external one, it removes its `updatefound` listener for good (workbox-window's `_onUpdateFound`).
  - Today that hardly matters: the check happens at launch, within the first second.
  - With checks during the session, almost every build found is external. Suppose the first one fails to install: the Wi-Fi drops mid-download, or the laptop lid closes. Then workbox-window never reports a later build, and the banner would not appear for the rest of that session.
- **The page guards already apply.** Every smoke test fails on a reload or a SKIP_WAITING without a click on Reload (web/e2e/fixtures.ts), and on any same-origin HTTP error.

## What changes

1. **When the app checks.** It calls `registration.update()` (the registration comes from `onRegisteredSW`'s second argument) in two cases:
   - when the page becomes visible again (`visibilitychange` with `document.visibilityState === 'visible'`): switching back to the tab or window, unminimising it, or waking a phone or laptop;
   - when the device comes back online (the `online` event).

   There is no timer and no throttle, since either would be a timing rule. Each return to the app costs one request for `sw.js`.
2. **When the banner shows.** After each check settles, including the new build's install if one started, the banner shows if a build is waiting. This does not depend on workbox-window's listener, so a failed install never silences later checks. `onNeedRefresh` stays as it is, for the check at launch.
3. **Failures show nothing.** Offline, server unreachable, an HTTP error on `sw.js`, or a failed install: the check catches the error, shows nothing, and the next return tries again.
4. **A test hook.** When each check settles, the app dispatches `sw-update-checked` on `window`, the same pattern as the existing `sw-registered`. Tests wait on that event instead of on time.
5. **Unchanged.** The banner's text and the Reload button stay as they are. So does `applyUpdate`, and the page still never reloads or lets a build take over without the student's click.

**One consequence for deploys.** After this change, a deploy reaches every open copy the next time its student returns to the app, not at their next launch. So open copies download the new build during a lab. Only the changed files download (Workbox keeps cached files whose revision is unchanged), but that is up to 31 MB when the engines change. Deploying outside lab hours avoids it.

## Decision

Jeff chose **events only** on 2026-10-26, over events plus an hourly timer:

- **Events only.** A window that is never hidden is checked only at launch and when the device reconnects. That means the app full-screen all session, or beside another window that never covers it.
- **Plus an hourly timer.** It covers that case. It costs one request an hour per open copy, a fake-timer Vitest of its own, and a timer that has to stop while the page is hidden.

## Acceptance bar

**A. Checks (Vitest, `web/src/pwa/register.test.ts`, fake registration and workers)**
1. The page becoming visible calls `update()` once. Becoming hidden calls it no times.
2. The `online` event calls `update()` once.
3. If `onRegisteredSW` gives no registration, no listeners are added and nothing throws.
4. A rejected `update()` is caught. No banner shows, no unhandled rejection reaches Vitest, and `sw-update-checked` still fires.
5. A check whose new worker reaches `installed` and is waiting shows the banner. One whose new worker becomes `redundant` does not. The banner waits for the install to finish; the test holds the worker's state and releases it.
6. The existing tests still pass: no reload or SKIP_WAITING without the click, and Reload still works in each case.

**B. In the browser (Playwright, `web/e2e/update.spec.ts`, `buildCopy`)**
1. **Return to the app.** The app is open with a drawing, and a second build is published. A `visibilitychange` dispatched by the test (the page's real state stays visible, which is what the handler reads) shows the banner. The page has not reloaded, the new build is `installed` and waiting, and the drawing is unchanged. Reload then loads the new build with the drawing.
2. **After failed installs.** The test publishes two builds whose install fails, one after the other: a `sw.js` whose install handler rejects, so there is no HTTP error for the guards to flag. It checks after each, and no banner shows. Then it publishes a good build and checks: the banner shows. Two failures are enough to make workbox-window stop listening within a short test, with no fake clock. While building, I show once that this test fails if the banner relies on `onNeedRefresh` alone.
3. **Offline.** The app is open with no network (`goOffline`). A `visibilitychange`, then `sw-update-checked`: no banner, and the guards see no page error.
4. The two existing update tests pass unchanged.

**C. Invariants**
1. Invariant 1: the check requests only the registration's own `<base>sw.js`. Review only: Playwright can't see the browser's update request, as update.spec.ts already notes.
2. Invariants 2 to 6 are untouched: no new data, chemistry, offline dependency or package.

**D. Docs and process**
1. docs/SPEC.md's checklist line becomes "Publishing a new build shows the update banner on next launch, and in an open app when the student returns to it or it comes back online". The "Updates and versioning" section gains the same sentence.
2. CHANGELOG.md: a "Changed" entry. BUILD-LEARNINGS.md: the workbox-window finding above. AGENTS.md stays at 149 lines or fewer.
3. Small commits on this branch: this plan; the check and its Vitest; the browser tests; the docs. `scripts/check.sh` passes before each, run as its own command with its exit status read.
4. Nothing merged, pushed or deployed.
