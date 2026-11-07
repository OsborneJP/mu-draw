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

(Filled in as the review runs.)

## Accepted limits

(Filled in from the review's lows.)
