# Anonymous usage counts

Requested by Jeff on 2026-10-27, choosing "Option 2, anonymous counts from the app": a way to see how many people use the app over time, and which tools they use.

**Approved by Jeff on 2026-10-27, with the proposed answer to every decision** (weekly totals; Practice not counted). The design was revised after a privacy review the same day, before building; the end lists what that review found.

This changes invariant 2 and the spec's privacy section ("No analytics", "no per-student logging"). After the change the rule is: **weekly totals only, never identifiers.** The server keeps one number per week per item. Nothing it keeps can tell one browser, student or device from another.

## How it works
- **The browser keeps a small summary of the current week** in local storage, under this build's own key, so staging and production stay apart. The summary holds:
  - on how many days the app was open (a count and the last day, not the dates);
  - whether it was opened as the installed app;
  - whether this is the browser's first week;
  - which tools were used (decision 2).

  Using a tool only updates this local summary. **It sends nothing.**
- **At the first opening in a new week, the browser sends last week's summary**, one POST to `<base>api/count`, and then forgets it.
  - That is one request per browser per week, at an opening, or when the student comes back to the app or it comes back online.
  - Apache doesn't log it, so its timing isn't recorded beside an address.
  - The request has no cookie (`credentials: 'omit'`), no referrer, no ID, no drawing, no SMILES and no setting. The summary is in the body, never in the URL.
- **The server only adds to weekly totals:**
  - browsers that week;
  - browser-days;
  - opened as the installed app;
  - new browsers;
  - one total per tool.

  It keeps no IP address, time or request body, and never reads the client's address. The totals live in their own database file (`usage.sqlite`), apart from the name cache.
- **Apache** stops logging `<base>api/count`. This is rendered into section (c) of docs/server-setup.md for Jeff to apply, like the other server settings. The server refuses bodies over 2 KB. (Apache can't: its `LimitRequestBody` skips proxied requests, found when (c) was applied on 2026-10-28, so the blocks no longer set it.)
  - Apache also marks those requests with an `X-Unlogged-Count` header, and the API takes a count only with it (otherwise a 503, which the browser treats as "try later").
  - So nothing is stored until the Apache blocks are in place.
  - The live checks also read Apache's access log for their own tagged count requests, so they fail if the log exclusion (the CustomLog edit) is missing.
- **A server that never answers** can't hold the week: the request gives up after the naming deadline (8 s, src/api.ts), and the summary is kept for the next opening.
- **Offline, or if the server doesn't answer:** the summary waits and goes with the next opening while online. A summary more than two weeks old is dropped. A summary the server refuses (a 4xx) is dropped, never retried.
- **Two tabs at once:** the browser lock API (`navigator.locks`) lets only one tab record or send at a time, so a week is sent once.
- **Opting out:**
  - A browser that sends Global Privacy Control sends nothing and records nothing. The server also ignores any count carrying the `Sec-GPC` header.
  - About has a switch, "Count my use anonymously". Turning it off forgets any summary and stops counting in that browser.
- **Event names are append-only.** A name is never reused or removed, so an older copy of the app (a student who hasn't clicked Reload) is still counted. Names the server doesn't know are ignored, never an error.
  - The list is web/src/usage/events.json. server/usage_events.json is an exact copy, kept so by a drift test.
  - tests/fixtures/usage_tools_shipped.json names every tool ever shipped. The server must still take each one.

## Decisions for Jeff (proposed answers in bold)
1. **Granularity:** **weekly totals, one request per browser per week.** The alternative is daily totals. Daily totals need a request on every day of use. With about 30 users a day, quiet days give cells of 1 or 2, which can point to a student you know was working.
2. **Practice:** **not counted.** Practice's approved plan promises "Practice adds nothing to browser storage and makes no request except GETs", and the spec gives it chem-tutor's rule of no per-student records. The alternative is to count it and amend those promises.
3. **Where you see the totals:** **a report script on the server**, `python scripts/usage_report.py`, printing one row per week. Nothing is on the web.
4. **Telling students:** **About says, in plain words:** "This app counts, each week, how many browsers open it and which tools are used. The counts are kept without names, IDs or IP addresses. The web server, like any, logs each visit's address for 14 days. Your drawings stay on this device: only Get name, Safety and the 3D view send a structure, and Name to structure the name you type, to this server, which asks PubChem." About also has the off switch. The alternative adds a one-time note under the header the first time a browser counts.

**Counted tools, with decision 2 as proposed:**
- in the header: Name to structure, Get name, Safety, Copy image, Export, Templates and its Glassware tab;
- below the canvas: the ¹³C and ¹H NMR previews, stereoisomers, tautomers, resonance and the 3D view;
- the Group button.

## Acceptance bar
**A. What leaves the browser** (Playwright, with a fixed clock: `clock.install` with time running)
- **The stub.** The fixture stubs `api/count` in every test, live checks included, so no test ever counts itself. The stub checks each body against the schema and fails the test on anything else, so every smoke test is also a privacy guard.
1. **A deterministic signal.** The app announces each counting decision with an event, `usage-settled` (sent, kept or skipped). `openEditor()` waits for it, so every test starts after the opening's decision. No test waits on time.
2. **The weekly request.** A fresh browser's first week sends no request. The next week's first opening sends exactly one, with last week's summary, in a body of the exact expected shape. A planted `Path=/` cookie is not sent, and the request has no referrer and nothing in the URL.
3. **Tools.** Using a tool many times in a week shows up as one tool in that week's summary, and using tools sends nothing.
4. **Offline and failures.** Offline at the new week, the summary is kept and sent at the next online opening; two weeks later it is dropped. A 4xx answer drops it; a 500 keeps it. The test holds the server's answer, then releases it.
5. **Two tabs.** With tab 1's request held, tab 2 opens and sends nothing; then the answer is released. The week is sent once.
6. **Opting out.** With Global Privacy Control, or the About switch off, no request goes and nothing is stored. Turning the switch off forgets a waiting summary.
7. **Existing tests.**
   - Every test starts after the opening's decision.
   - web/e2e/practice.spec.ts ("practising stores nothing and sends nothing") keeps its storage check unchanged, since Practice isn't counted.
   - That test and autosave's "nothing was uploaded" set aside a count request, which the fixture checks holds nothing else. A run that crosses Monday midnight may send one.
8. **The deadline.** With the server's answer held, running the clock 8 s forward gives up the request and keeps the summary.
9. **The guard is live.** A count request that isn't exactly a summary is reported: other keys, a tool not counted, a referrer or a cookie.

**B. The server** (pytest, network blocked)
1. **Totals.** A summary adds exactly its items to that week's totals.
2. **Refusals.** A body of the wrong shape, or a week outside the last 3 or the next 1 (time zones), is refused with a 400 and counts nothing. An unknown event name is ignored.
3. **Opt-out and size.** `Sec-GPC: 1` counts nothing, and a body over 2 KB is refused.
4. **What is stored.** The database file's raw bytes, with its journal, hold only week, item and count, in a table with no row order (`WITHOUT ROWID`). test_privacy's sentinel, put in every field of a count body, never reaches the logs.
5. **Event names.** Every event name ever shipped is accepted. The list is append-only, in one file the web and the server share, with a drift test.
6. **Report.** The report script prints the table for a recorded database, with a drift test.
7. **Apache.** The rendered Apache block marks `<base>api/count` (SetEnvIf) for the vhost's access log to skip, and sets no body limit, which Apache wouldn't apply to a proxied request. A render test checks both. The doc's section (c) says how to apply it.
8. **Live checks.** One posts a deliberately wrong body and expects the endpoint's own 400. Another posts one over 2 KB and expects the API's own 413 (`too_large`). They prove the route is live and count nothing.

**C. Docs.**
- Invariant 2 in AGENTS.md and the spec's privacy section say what is counted, what is never kept, and the guards that enforce it.
- About's wording and switch each have a test.
- check.sh passes.

## Found in the review of the code (2026-10-27; fixed, each with a test)
- **Medium:**
  - **The About switch could be undone.** Turning it off while a summary was on its way could be undone by the summary's answer. The switch now waits its turn behind the summary, and About re-reads it each time it opens.
  - **The database file kept arrival order.** It kept the order summaries came in (page cells, and freed bytes), which, with Apache's log, could tie the first summary of a week to an address. It now runs `secure_delete` and `VACUUM` after each write, so the same totals give the same file byte for byte, in any order.
  - **The two-tab browser test had a timing budget.** It now opens both tabs first, pauses time at the new week, and triggers both with an `online` event.
- **Low:**
  - **A refused lock.** A browser that refuses the lock (site data blocked) still settles the opening ("off"). A browser with no lock API takes turns within the tab.
  - **A clock moved back.** It no longer ends the current week early.
  - **Full storage.** Storage that won't keep this week sends nothing, so nothing is sent at every opening.
  - **Answers.** 404, 408 and 429 keep the summary for later, and a redirect is not "taken".
  - **The local record** keeps a count of days and the last day, not each date.
  - **"Installed"** no longer counts a fullscreen tab. One shared test, `runningInstalled`, serves both this and the install offer.
  - **Apache.** Section (c) of docs/server-setup.md now orders the restart after the deploy, and the API refuses counts Apache hasn't marked.
  - **The privacy test** now drives the storing path, with the sentinel in every field, and checks the files.
  - **About** now says "about two weeks" for the web server's logs, and that the switch is kept in this browser.

## Found in the second review (2026-10-27; fixed, each with a test)
- **Medium:**
  - **The privacy sentinel was too long to be taken.** At 41 characters, longer than a tool name may be, it was refused, so the storing path never carried it. It is shorter now, and the test asserts the post is taken.
  - **The header proved the pasted blocks, not the log edit.** The live checks now tag their count requests and fail if any appears in Apache's access log.
- **Low:**
  - Global Privacy Control no longer erases a student's own "off".
  - A record left by a clock once set more than a week ahead starts again from this week.
  - A failed VACUUM after the totals are stored no longer answers 500, which would have the week sent again.
  - Tests now cover the fixes that had none: how answers are read (`answerFor`), turn-taking without the lock API, the installed-app test (fullscreen is a tab), and About re-reading the switch.

## Third review (2026-10-27): nothing high or medium, so reviewing stopped
Its lows are accepted limits, below:
- the log-rotation window;
- the staging error log;
- the live check's reliance on Apache writing its log unbuffered.

## Accepted limits
- **The log check around midnight.** The live checks read the current access log. A run whose count requests land in the few seconds while logrotate swaps the file at midnight could miss a logged line. The manual check in docs/server-setup.md (c) step 5 is the backstop.
- **The live check relies on unbuffered logs.** It sends its count requests first and reads the log last, which relies on Apache writing each line as the request ends. It does on this host (no `BufferedLogs`).
- **Staging's error log.** An installed staging app opened off campus gets a 403, and Apache's error log records that with the address and the count path. Staging is for Jeff and testers, and production is public, so it has no such 403.
- **Counted twice.** A summary whose answer is lost (the deadline, a closed tab) is sent again at the next opening, so it may be counted twice. Totals are a guide.
- **Without the lock API** (Safari before 15.4), two tabs open at once can each send the same week.
- **The file's modification time** shows when the totals last changed (the administrator limit below).
- **The switch can be lost.** It is kept in this browser's storage, so clearing site data, or Safari's storage purge, turns counting back on.
- **Inflated counts.** Anyone can send counts, since there are no accounts, so they are a guide, not a measure.
- **Browsers are not students:**
  - a week is lost if a browser never opens the app again;
  - a student on two devices, or in two browsers, counts twice;
  - cleared storage, private windows, shared lab profiles and Safari's storage purge all make "new browsers" read high;
  - in the first week of counting, every existing student counts as new.
- **The administrator.** The server's administrator could watch the totals change live and line that up with the update-check entries in Apache's log. The stored totals have no times, so nothing can be linked afterwards.

## Privacy review, 2026-10-27 (before building)
An independent review of the first draft (a daily count per tool use) found:
- **High:**
  - one request per tool use, which Apache's log ties to an IP address;
  - About wording that claimed no IP addresses were kept;
  - "nothing was sent" checks with no deterministic signal.
- **Medium:**
  - Practice's no-storage promise;
  - small daily cells and no retention rule;
  - cookies from other apps on the same host riding along;
  - two-tab races, midnight edges and retries;
  - time zones at the day window;
  - older app copies against a newer server, and live checks that never touch the endpoint;
  - Global Privacy Control alone as an opt-out.
- **Low:**
  - SQLite row order;
  - raw-file scans;
  - a separate database file;
  - clock and offline test details;
  - body limits;
  - where the sentinel goes;
  - the client address reaching the app;
  - listing the guards under invariant 2.

The design above answers each finding:
- weekly summaries, one request per week;
- Apache's log exclusion;
- the `usage-settled` event;
- omitted cookies;
- locks between tabs;
- wider week windows;
- append-only event names;
- a live check;
- the server honouring Sec-GPC;
- the About switch;
- `WITHOUT ROWID`.
