# Offer to install the app

Requested by Jeff on 2026-10-27: "if a user hasn't installed the website as an app, and the user is on a browser that would support such installation, could we have a message in the top line that prompts the user to install as an app, perhaps providing some helpful instructions that will age well?"

**Approved by Jeff on 2026-10-27, with the proposed answer to all three decisions.**

## How browsers tell a page it can be installed
- **Chrome, Edge and other Chromium browsers** (Windows, Mac, ChromeOS, Android) send the page a `beforeinstallprompt` event. They send it only when:
  - the app can be installed in that browser;
  - it isn't installed there already;
  - the page isn't running as the installed app.

  The page can keep the event and, when the student clicks, call its `prompt()`. That opens the browser's own install dialog, the same one as the install icon in the address bar.
- So the app never has to guess the browser or describe a menu: if the event came, installing works there. That is what lets the message age well. When browsers move their menus, the button still opens their own dialog.
- **Safari and Firefox send no such event.**
  - Safari 17+ on a Mac installs from **File → Add to Dock**.
  - Safari on an iPhone or iPad installs from **Share → Add to Home Screen**.
  - Firefox on a computer has no general way to install.

  A page can only spot these browsers by their user-agent text, which is the part that ages badly.
- **An installed app knows it is one:** it runs with `display-mode: standalone`. A tab of a browser that has the app installed gets no event.

## What a student would see (proposed)
- A pale strip under the header, styled like the update banner:

  > **Install MU Draw as an app:** it opens in its own window, like your other apps, and works offline. [Install] [Not now]

  (First proposed as "from the Dock or Start menu". Changed in review, since that is wrong on Android, ChromeOS and Linux.)

  It uses the build's own name, so staging says "MU Draw (staging)".
- **Install** opens the browser's own install dialog. Once the student installs, the strip goes away. If they cancel the dialog, the strip goes away until the next visit.
- **Not now** hides the strip in this browser for good. The About box keeps an "Install as an app" button for as long as the browser offers installation, so a student who said no can still install.
- Nothing is shown in Safari, in Firefox, in the installed app, or in a browser that already has the app installed.

## Decisions for Jeff (proposed answers in bold)
1. **Where:** **a strip under the header, like the update banner.** The alternative is an "Install app" button in the header itself, which is already full at 1024 px wide.
2. **"Not now":** **hidden for good in this browser (About still offers Install).** The alternative is that it comes back at the next visit. A timed return ("in a week") is a timer rule the project avoids.
3. **Safari:** **nothing shown, because the app can't tell Safari's version reliably.** The alternative is a one-line hint on Safari only, "In Safari: File → Add to Dock (Mac) or Share → Add to Home Screen (iPhone, iPad)". That relies on reading the browser's user-agent text and on Safari's menu names.

## Acceptance bar (with the proposed answers)
**A. Shown only when installing works**
1. When the browser offers installation, the strip shows with Install and Not now.
2. Nothing shows:
   - when no offer comes;
   - when the page runs as the installed app;
   - after Not now, including after a reload;
   - after the app is installed (the browser's `appinstalled` event).
3. The offer is caught however early it comes, before or after the page has drawn. Tests send it at both points.

**B. Install**
1. Install calls the browser's `prompt()` once, inside the click, and hides the strip. The offer is used up, so neither the strip nor About can press it twice.
2. **If the student cancels the dialog:**
   - Chrome offers again at once. About takes that offer, but the strip stays away until the next visit.
   - Nothing is remembered.
3. The app never waits for the student's answer to the dialog, so there is no ordering to force. A browser that refuses the dialog, rejecting or throwing, leaves no error.

**C. About:** shows "Install as an app" while an offer is held, Not now or not. It does the same as the strip's Install.

**D. In real Chrome**
- The strip appears in the test browser (full Chromium) for the built app, and Install hides it after calling Chrome's own `prompt()`.
- The engagement check Chrome may apply is turned off for that test with Chrome's own switch (`--bypass-app-banner-engagement-checks`).
- Every other test keeps Chrome's real offers away from the app (the fixture's `browserInstallOffers`, off by default). So a strip can never push the canvas down in the middle of a test, and the live checks see no strip either.

**E. Unchanged:**
- No request leaves the page: the event, the dialog and Not now's record are all local. Invariants 1 and 2 hold.
- The update banner works beside it.
- check.sh passes.

## Found in review (2026-10-27; fixed, each with a test)
- **Medium:** Chrome offers again as soon as the dialog is cancelled, so the strip came straight back, against "goes away until the next visit". The strip now stays away after Install for the rest of the visit, and About takes the new offer.
- **Low:** no test showed that Install calls `prompt()` inside the click.
  - The tests' offers now record the click's user activation at `prompt()`.
  - The real-Chrome test wraps Chrome's own `prompt()` the same way: exactly one call, with activation.
- **Low:** the "before the app is drawn" offer was sent at DOMContentLoaded, which React may beat. It is now sent the moment the app starts listening, and the test checks nothing was drawn yet.
- **Low:** the fixture's count of stopped offers was polled. It is now a promise the test awaits.
- **Low:** Not now didn't reach other open tabs. It now does, through the storage event.
- **Low:** the wording named the Dock and the Start menu. It now says "like your other apps".
- **Low:** About's Install button took keyboard focus with it. Focus now moves to Close.
- **Nit:** "the installed app" now means any display mode but `browser`, not only `standalone`.

## Accepted limits
- In everyday use, Chrome makes its offer after some use of the site, so the strip usually appears while the student is drawing. The canvas then moves down by the strip's height, as it does for the update banner.
- Safari and Firefox users see no offer (decision 3). The spec already names Chrome and Edge as the install route.
- Chrome may show its own install icon in the address bar at the same time. That is the browser's, and it does the same thing.
