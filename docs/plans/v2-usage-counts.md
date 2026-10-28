# Anonymous usage counts

Requested by Jeff on 2026-10-27, choosing "Option 2, anonymous counts from the app": a way to see how many people use the app over time, and which tools they use.

**Approved by Jeff on 2026-10-27, with the proposed answer to every decision** (weekly totals; Practice not counted). The design was revised after a privacy review the same day, before building; the end lists what that review found.

This changes invariant 2 and the spec's privacy section ("No analytics", "no per-student logging"). After the change the rule is: **weekly totals only, never identifiers.** The server keeps one number per week per item. Nothing it keeps can tell one browser, student or device from another.

## How it works
- **The browser keeps a small summary of the current week** in its own storage (IndexedDB since the revision below; localStorage before), under this build's own name, so staging and production stay apart. The summary holds:
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

## Revision, 2026-10-28: the record moves to IndexedDB (approved by Jeff the same day)
Production's live smoke test of bar A.5 (two tabs) failed once: the second tab sent the week
again. Chromium caches localStorage in each tab and passes another tab's writes on later, so
the lock doesn't make the next tab read what the last one wrote. A probe: after a lock handoff
the next tab read stale localStorage in 15 of 300 tries, and IndexedDB, with each write's
commit awaited, in none (BUILD-LEARNINGS). IndexedDB answers every tab from one place.

**Bar R** (added to A and B, which stand):
1. **Where.** The record lives in IndexedDB (database `usage:<base>`, one object store, one
   key), read and written only in the lock's turn; every write waits for its transaction to
   complete before the turn ends. Test: A.5 (two tabs), and every Playwright usage test reads
   the record from IndexedDB.
2. **The build before's record** (localStorage key `usage:<base>`, kept by c2f4683, on
   production from 2026-10-28 11:32 until this build) is read in every turn, and its week is
   **not carried over**. c2f4683 counted only from 2026-10-28, the first week of counting, so
   this record holds the same for that week; only days and tool uses before the reload are lost
   (all of that week, for a browser whose next opening after the update is in a later week).
   One fact is kept: a record started here isn't a new browser's if c2f4683's record shows it
   counted the browser in an earlier week (review round 4: otherwise every browser that used
   c2f4683 would be "new" twice). (Carrying the whole record, as first planned, drew review
   findings three rounds running, all in its interplay with that build's still-open tabs;
   dropping it removed them.) Its "off"
   counts as off here too, in every turn (nothing counted or sent, About shows off), and forgets
   what is kept here, as that build's switch forgot. It stays in the old key, which that build's
   tabs read; only the switch removes it (review round 1, high). Turning counting off writes
   "off" to both places; turning it on removes both. Its record (not "off") is removed once its
   week has passed, or if it isn't a record: until then a tab of that build may be counting
   with it, and removing it could erase an "off" that tab had just written but this tab's
   localStorage doesn't show yet (review round 2). An "off" kept only in IndexedDB holds as well
   (the old key can lose it). Tests: Vitest for each rule; Playwright for an
   old "off" (nothing recorded or sent, About's switch off, the old key kept) and an old week
   (this build counts its own; the old record goes the next week).
3. **Unreadable.** If the record can't be read (storage blocked or failing), nothing is
   written, counted or sent, and About shows counting off. A failed read never overwrites an
   "off", and a write that doesn't commit counts as not stored (nothing sent). Tests: Vitest;
   Playwright with writes whose transaction aborts.
4. **About.** The switch is read each time About opens, in the lock's turn (so behind a summary
   on its way), and is disabled (and `aria-busy`) until the read comes back; after a change it
   shows what was stored, the latest read winning. Tests: Vitest (the read waits its turn);
   Playwright, holding the lock (the read queued, the switch disabled, then the stored state),
   with another tab's change, and with a change the store refuses (the switch springs back).
5. **Global Privacy Control** runs in the lock's turn too. An old "off" is kept; an old week is
   removed whatever IndexedDB's state; anything in IndexedDB but "off" is forgotten. Reading or
   removing never creates the database, so a browser with GPC gets none. Tests: Vitest
   (including GPC waiting behind a summary's answer, and removing an old week while IndexedDB
   can't be read), and A.6 in Playwright (no database).
6. **After a send,** the record isn't written over an "off", or over a record it can't read
   (without the lock API another tab can change it meanwhile). Tests: Vitest, with a lock that
   doesn't serialise.
7. **Nothing else changes:** the request, the server, the wording, and no new dependency.
8. **Practice** still stores nothing: its test compares the usage record too.

**Reviews of the revision** (three lenses each: concurrency, switch-over and privacy, tests;
two skeptics on every high or medium):
- Round 1: high, an old "off" removed from where c2f4683's tabs read it; mediums, an uncopied
  old "off" didn't stop a turn, and About's re-read was untested. Fixed, with tests.
- Round 2: mediums, removing an old week's key on a possibly stale read, and three untested
  guards. Fixed, with tests.
- Round 3: medium, an "off" set in a c2f4683 tab didn't forget this build's record. The design
  then stepped back: the old week is no longer carried over at all.
- Round 4: mediums, three untested guards, and browsers c2f4683 had counted being "new" twice
  (newHere()). Fixed, with tests; each guard checked by a mutation the tests catch.
- Round 5: nothing high or medium survived the skeptics, so reviewing stopped. Its lows are
  below.

## Accepted limits
- **Review round 5's lows:** a browser whose first opening of this build is in a week after
  its c2f4683 week is never counted as new (that week is lost whole; R.2); the IndexedDB "off"
  checks in open() and use() are also held by today() throwing on "off", so removing them
  changes no outcome a test sees; without the lock API (Safari before 15.4), a c2f4683 tab's
  switch-off during this build's send isn't seen by the write after it (the next turn sees it);
  a failed first write after the old record's week has passed loses only its "not new" fact.
- **The switch-over.** A tab still running c2f4683 (until its student clicks Reload) keeps its
  record in localStorage. If such a tab and a tab of this build both act at a new week's first
  opening, each can send that week. A student who turned counting off in this build and then
  on in an old tab stays off in this build's tabs (it fails towards off). An "off" set in an old
  tab at the very moment a
  tab of this build takes the lock with a stale localStorage can still be erased when an old
  week's key is removed, as c2f4683's own tabs could erase each other's; removing the key only
  once its week has passed makes that need a new week's first move too. It lasts only until the
  old tabs reload; an "off" stays in the old key after that, which is harmless.
- **About's "latest read wins"** has no test of two reads finishing out of order (review round
  2, low): the guard is one comparison in AboutBox.tsx.
- **Review round 4's lows:** a failed IndexedDB open that reports AbortError reads as "no
  record" (it then counts afresh, as with no database); use() checks Global Privacy Control
  before its turn, as c2f4683 did; About's "disabled until read" is tested on the first open
  only.
- **No deadline on IndexedDB.** A store call that never settles (a WebKit bug in Safari 14.1)
  would hold the lock's turn: nothing is counted and About's switch stays busy. It fails
  towards off, and that Safari is all but gone (review round 3, low).
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
