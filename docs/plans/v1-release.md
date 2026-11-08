# Version 1: the last hand checks, a milestone review, and 1.0.0

Requested by Jeff on 2026-11-07 ("Finish v1 first"). He chose it over a plan for structure
from image and the other "Later version" features: put v1 in front of CHEM-311 first.

Status: **the decisions below are proposed (in bold) and wait for Jeff's answer.** The review
runs meanwhile; it changes nothing by itself, and its fixes follow the bar below.

## Where v1 stands (2026-11-07)

- Production runs 4067287: the spec's Version 1 features, the ¹³C NMR proof of concept, and
  the "After v1" features built so far, each with its plan here.
- The spec's Testing checklist has 15 boxes ticked and 7 open. All 7 are by hand; each also
  has automated tests:
  - offline: properties, functional groups and export work, and the naming buttons say why not;
  - the update banner, at next launch and in an open app;
  - properties against server-side RDKit for the reference compounds;
  - the stereocentre count (2-butanol; open-chain glucose);
  - Get name on 20 known compounds and 3 invented ones;
  - Name to structure's Add and Replace, and the name shown beside the typed name;
  - (R)- and (S)-2-butanol: different names, the right wedges.
- The NMR section's box "Option A only: offline shows the standard message" is open too.
- The version is 0.1.0 (About shows it), with no release tag.

## Decisions for Jeff (proposed answers in bold)

1. **The NMR box "Option A only" is marked not applicable.** Jeff chose B's shape on
   2026-10-24, built in the app, so the prediction works offline (an offline test checks it).
2. **The hand checks run on production, in the installed app:** Chrome or Edge on Windows 11
   and Chrome on macOS, the platforms the spec names. The update-banner box needs a new build
   published while the app is open. The deploy of this review's fixes is that build. Jeff says
   when the app is open on both laptops, then I deploy and he checks.
3. **1.0.0 is the build production verifies after the review's fixes and Jeff's checks,** with
   every feature shipped so far, the "After v1" ones included. The tag `v1.0.0` goes on that
   commit and is pushed with main.
4. **None of these blocks 1.0.0**, and each stays where it is recorded:
   - who else maintains the app (the spec's open question);
   - the name ("MU" is the university's mark) and the ownership and licence questions;
   - the judgement files marked provisional, and the IR bands marked "verify" (never shown);
   - the course template libraries, which wait for Jeff's lists.
5. **The review gets about three hours and at most three rounds**, under the rule below.

## Acceptance bar

**A. The hand checks**
1. Every Testing-checklist box is ticked on Windows 11 and on macOS, by Jeff.
2. The steps are in docs/v1-hand-checks.md. `python scripts/build_hand_checks.py` renders
   it from the generated fixtures (tests/fixtures/reference_expected.json,
   name_responses.json), so no name, SMILES or value in it is typed by hand. A pytest
   re-renders it and byte-compares, as for docs/server-setup.md.
3. Jeff reports what he saw, and I tick each box with his name and the date, as before.

**B. The milestone review** (exploratory; once, at this milestone)
1. **Scope:** what the reviews of single features could not see.
   - Requests, links and privacy across all features together (invariants 1 and 2).
   - Offline and updates: the precache across features, the update banner, and what an older
     build left in the browser (drawings, settings, usage records) read by the new one.
   - The spec's v1 chemistry claims (properties, Lipinski, stereocentres, functional groups,
     Get name, Name to structure): whether the tests check what each open box says.
   - The student's screen at laptop and desktop widths with every panel and button, and the
     keyboard; the APIs used that Chrome and Edge on macOS handle differently.
   - The server with a whole lab section on every endpoint: one worker, queues, deadlines
     against the browser's 8 s, memory against the unit's limit, the caches' growth.
   - Deploy and recovery: a failed production deploy, the API down, a restart forgotten.
2. **The bar each finding is judged against:** the spec's Version 1 features and Testing
   checklist, the six invariants, AGENTS.md's conventions, and the feature's own plan. A
   finding names which of these it breaks, and a concrete failure: what is done, and what goes
   wrong.
3. **Severity.**
   - High: a student gets wrong chemistry or loses work, the app can't be used on a platform the
     spec names, or an invariant breaks.
   - Medium: a feature fails in a realistic case, with a workaround; or a guard doesn't check
     what it says.
   - Low: anything else.
4. **Verified:** two skeptics try to refute each finding; one that either refutes is dropped,
   unless I reproduce it.
5. **Fixed:** every confirmed high or medium, each with a test that fails on the commit before.
   check.sh passes before each commit.
6. **Stopping rule:** round 2 reviews only round 1's fixes, round 3 only round 2's. Stop at the
   first round with nothing high or medium, or after round 3. If a round's fixes cause new
   highs or mediums, stop and propose a simpler design instead of a further patch. Lows go to
   "Accepted limits" below.
7. **Probes:** reviewers read code and may run throwaway probes under the heavy-commands lock,
   against a local build only, never staging or production.

**C. The release**
1. web/package.json's version is 1.0.0 (About shows it), and CHANGELOG's "Unreleased"
   becomes "[1.0.0]" with the date.
2. check.sh passes; staging, then production, pass their live checks.
3. The tag `v1.0.0` is on the commit production verified, and main and the tag are pushed,
   on Jeff's say-so.

## Review rounds

### Round 1 (2026-11-07): six reviewers, two skeptics for each finding

One reviewer for each area of B.1. They raised 18 findings; 9 stood through both skeptics.
Fixed, each with a test that fails on the build before (staging's, at 4067287):
- **High: with two windows open, a reload lost a drawing.** Every window shares one autosaved
  drawing, and the last save wins: the update banner's Reload, or a refresh, brought back the
  other window's drawing. Each window now writes its own back as it goes (fadf6b0).
- **High: Aromatize hid an aromatic N-H from RDKit.** Ketcher keeps it only as an H count its
  Molfile writer drops. Imidazole, histidine, purines and pyrimidine bases showed no values;
  guanine and allopurinol showed a formula two H short. The worker now gives RDKit those
  hydrogens (75cdee5).
- **Medium: Ketcher's full-screen button showed the editor alone,** without the header, the
  panels or the Group button. The whole app goes full screen now (ec227e4).
- **Medium: Name to structure waited for PubChem's stereo check.** With PubChem busy, 20 of a
  class of 30 got "not responding" and nothing was drawn. The check gives up at 6 s (4336c3c).
- **Medium: Safety under a class's load.** Its two PubChem lookups for 30 students take 12 s
  at PubChem's limit, so 20 of 30 got "not responding" at 8 s. Safety waits 15 s now, which
  changes the Safety plan's 8 s (1be04ff).

### Round 2 (2026-11-08): the five fixes only, two skeptics for each finding

Two fixes caused new problems, so under B.6 the review stopped here and a simpler design went
to Jeff instead of another patch:
- **High, caused by fadf6b0 (two windows):** the write-back on the way out also runs when a
  window closes. An idle second window, still holding the drawing it restored, writes it over
  the student's later work when it is closed last, and the next launch shows the old drawing.
  Beside a window still on the build before (during an update), the new window's write
  replaces the old window's newer drawing. Both skeptics reproduced both.
- **Medium, caused by 75cdee5 (aromatic N-H):** the tautomer and resonance cards now get the
  Kekulé bonds too, so a ring the student drew aromatic no longer counts as either order:
  aromatized pyridinium, readable before, lost its second "Your drawing" card and highlights
  all six ring bonds.
- **Medium, older than ec227e4 (full screen; one skeptic dropped it as out of scope):**
  Ketcher's drop-down lists (Save's file format, the atom and bond dialogs, Settings, the
  abbreviation lookup) open outside the app's root, so in full screen they are invisible.
  Marking the whole page instead of the app's root fixes it too (a skeptic's probe).

Its lows: the stereo-check test passes with the cancel removed, and would hang rather than
fail if the race regressed; the Safety tests pin a constant rather than a class's load;
requestSafety's comment still says it has Get name's deadline.

### The simpler designs (Jeff approved them on 2026-11-08)

Each has a test that fails on the commit before it, and its own commit after check.sh.
1. **Each window keeps its own copy** (in place of fadf6b0's write-back).
   - Every change is saved twice: to the copy all windows share (localStorage, as before),
     and to this window's own copy (sessionStorage, which the browser keeps for the window
     across reloads and drops when it closes). The same for the groups.
   - A window starts from its own copy when it has one (a reload, the update banner's
     Reload), else from the shared one (a launch, a new window), which becomes its own at
     once. Nothing is written when a window is hidden or closed.
   - If the own copy can't be written, it is removed, so a reload takes the shared copy
     rather than an older own one.
   - Tests: an idle second window closed last leaves the student's later drawing for the
     next launch (e2e, fails on 1be04ff); the two-windows reload test stays.
   - Limit: a window still on production's build before this one has no own copy, so its
     first reload into the new build can bring back another window's drawing, as before.
2. **Tautomers and resonance get the hydrogens with the bonds as drawn.** Their requests
   get the noted hydrogens as atoms and the drawing's own bond types; the properties panel,
   NMR and stereoisomers keep 75cdee5's Kekulé bonds. Tests: for every forms fixture written
   aromatic as Ketcher writes it, the lists are those of the drawing without 75cdee5 wherever
   RDKit read that as the compound drawn, and listed for the rings it couldn't read.
3. **Full screen marks the whole page** (`<html>`, not the app's root), so Ketcher's lists,
   which open outside the root, show in full screen. Test: Save's format list is under the
   pointer in full screen (e2e, fails on 1be04ff).
4. requestSafety's comment names its own deadline.

Round 3 reviews these changes only, as round 2 did, and is the last.

## Accepted limits

From round 1: the lows that stood, and the findings the skeptics dropped as breaking nothing
in the bar though their mechanism is real.
- **Esc doesn't close Ketcher's own dialogs** (Open, Save, Settings, Structure Library,
  Periodic Table) unless a text field has the focus: Ketcher's macromolecules editor, mounted
  though it is disabled, takes the key. Cancel and × close them; the app's dialogs close on Esc.
- **The 3D panel scrolls sideways by 2 px** (its viewer's border); Windows shows a scrollbar.
- **The header at 125% or 150% zoom on a laptop:** below about 1,020 px of page width the
  labels wrap out of the bar, and below about 900 px About goes off the edge and the page
  scrolls sideways.
- **The name cache keeps the time of each lookup to the microsecond,** so someone who can read
  both it and Apache's access log could match a cached structure, or a typed name that named
  nothing, to an address. Both files are readable only on the server.
- **Lookups carry other osbornelab apps' cookies** (a Path=/ cookie). The API never reads them
  and Apache doesn't log them.
- **TPSA exactly at a tie** (x.25, as for ethanolamine) shows rounded up in the panel and
  rounded to even by the fixture generator; no fixture compound has one.
- **With PubChem busy,** a class's retries wait behind its first attempts, so students see
  "not responding" rather than "Busy, try again shortly".
- **If the env's java can't run when the API starts** (during an env update), the whole API
  fails to start, not only OPSIN.
- **A deploy that changes server code** publishes the new web build before the API is
  restarted; until then a new endpoint says "not responding".
- **One conda env** serves development and both API units; needrestart restarts the units
  unattended onto whatever env is on disk.
- **The usage totals are not backed up,** and a rename starts a new state directory, leaving
  the old totals in the old one.
