# Version 2: safety snapshot (GHS pictograms and hazard statements from PubChem)

Requested on 2026-10-26 (docs/SPEC.md, "After v1" > "Teaching features": "Safety snapshot: GHS
pictograms and hazard statements from PubChem").

The aim: a student draws a compound, clicks Safety, and sees its GHS hazard pictograms, signal
word and hazard (H) statements as PubChem lists them, with the source credited. It also says
plainly that this is no substitute for a safety data sheet or a risk assessment.

## What a student sees

1. A **Safety** button in the header, after Get name. Like Get name, it is greyed while offline
   ("Needs an internet connection"), while the canvas is empty, and while a lookup is on its way.
   The drawing goes to the server only when the student clicks.
2. The snapshot docks below the canvas, like the ¹³C NMR preview. Only one panel is open there at
   a time, so Safety closes Practice, NMR and the stereoisomers (and the tautomer panel, once merged),
   and they close Safety. Any change to the drawing closes it, as with Get name.
3. In the panel, from top to bottom:
   - the compound, as PubChem names it, with its CID;
   - the reminder (decision 4);
   - the signal word, "Danger" or "Warning";
   - the pictograms, as the app's own images, each with PubChem's name under it ("Flammable");
   - the H statements, in PubChem's order. Each has its code, its words, and the hazard class in
     smaller type. For ECHA's notified classifications it also has the share of notifications,
     "(37.7%)" (decision 7);
   - one line naming the source (decision 2) and its credit (decision 5);
   - "PubChem lists 10 more classifications for this compound (ECHA notifications, NITE-CMC,
     HCIS, HSDB). They may differ." with "Open in PubChem", the same link Get name gives
     (decision 3).
4. The other outcomes are in decision 6.

## Measured before planning (2026-10-26; throwaway probes saved outside the repo)

PUG View: `GET https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/<CID>/JSON?heading=GHS+Classification`,
for the 27 compounds that Get name's tests already record (their `smiles-*.json` give the CIDs),
plus benzene, racemic 2-butanol and paraquat dichloride: 30 records. The URL holds only the CID;
the SMILES reaches PubChem only in a POST body, in the same request as Get name's lookup.

- **Shape.** Answers are 8–170 KB. Under Safety and Hazards > Hazards Identification > GHS
  Classification, each classification is a run of `Information` items sharing one
  `ReferenceNumber`:
  - `Pictogram(s)`: image URLs `…/images/ghs/GHS0n.svg`, with the name in `Extra` ("Irritant");
  - `Signal`: "Danger" or "Warning";
  - `GHS Hazard Statements`: one string each, for example
    "H225: Highly Flammable liquid and vapor [Danger Flammable liquids]";
  - `Precautionary Statement Codes`: P codes only, no text;
  - for ECHA only, `Note` and `ECHA C&L Notifications Summary`.

  `Reference` gives each source's `SourceName`, `Name`, `URL`, and usually `LicenseNote` and
  `LicenseURL`.
- **Sources** (139 classifications across the 28 records that have a section):
  - NITE-CMC (Japan): 47, often one per fiscal year;
  - ECHA C&L Inventory, companies' notified classifications aggregated by PubChem: 42;
  - the EU harmonised classification (Regulation (EC) No 1272/2008, CLP Annex VI): 20;
  - HCIS, Safe Work Australia: 20;
  - HSDB (US NLM): 10.
- **PubChem's order** is by `SortOrder`. The EU entry is always first (100000). ECHA entries
  follow, by company reports (3000 + reports). Then NITE by year, then HCIS (10) and HSDB.
- **Sources disagree a lot.**
  - Ethanol: EU gives H225 only; ECHA gives H225 and H319 (37.7%); NITE gives H350, H360 and H372
    as well.
  - Caffeine: EU, ECHA and HCIS give Warning, H302; NITE gives Danger, H301, H332 and H360.
  - Aspirin has no EU entry. ECHA gives H302, H315, H319 and H335; NITE gives H334, H360 and more.
- **Applying decision 2's rule:**
  - EU harmonised for 18 records: acetone, benzene, benzoic acid, ethanol, pyridine, toluene,
    caffeine, aniline, both 2-butanol enantiomers and the racemate, boric acid, bromobenzene,
    ethyl acetate, 1,4-dimethylcyclohexane, paraquat dichloride, nicotine and maleic acid;
  - ECHA for 6: DMSO, paracetamol, aspirin, ibuprofen, paraquat (the dication) and sodium
    benzoate;
  - "Not Classified" from ECHA for 4: glucose, L-alanine, cholesterol and cinnamic acid. For
    cinnamic acid, a second ECHA entry for the trans acid gives Warning, H315, H319 and H335;
  - no GHS section at all for 2: aldehydo-D-glucose and the tetramethylammonium cation (a 404
    with `PUGVIEW.NotFound`);
  - every record with a section had an EU or ECHA entry.
- **ECHA's numbers.** Its percentages are shares of the notifications that give hazard codes.
  PubChem lists only codes above 10%. Its `Note` can matter more than the codes: for DMSO,
  "This chemical does not meet GHS hazard criteria for 65.1% (611 of 938) of all reports", yet
  the entry shows Warning, H315 (28.4%), H319 (33.6%) and H335 (13.8%).
- **Statement formats seen:**
  - `H225:`, `H319 (37.7%):` and `H225 (> 99.9%):`;
  - suffixed codes, `H360FD:`;
  - CLP Annex VI notes, `H373 **:` and `H361d ***:`;
  - combined codes, `H301+H311 (100%):`;
  - ECHA repeating a code from different notifications (paraquat: H301 twice);
  - "Not Classified", followed by "Reported as not meeting GHS hazard criteria by 946 of 969
    companies (…)";
  - no EUH statements in this sample. Paraquat dichloride has two EU entries; boric acid's two
    are identical.
- **Pictograms seen:** GHS02, 05, 06, 07, 08 and 09. GHS01 (explosive), 03 (oxidiser) and 04 (gas
  cylinder) did not appear, but the app ships all nine.
- **Licences** (from PubChem's `LicenseNote`/`LicenseURL`, and the sources' own pages):

  | Source | Terms | What the app must show |
  |---|---|---|
  | EU harmonised (EUR-Lex) | EUR-Lex editorial content: CC BY 4.0 (PubChem's note) | the source, the licence |
  | ECHA C&L Inventory | "may be reproduced … for non-commercial purposes provided that ECHA is acknowledged as the source: 'Source: European Chemicals Agency, http://echa.europa.eu/'. Such acknowledgement must be included in each copy" | that sentence, exactly, wherever ECHA's data shows |
  | NITE-CMC | any use, commercial too; "must cite the source"; edited content must say it was edited | the source, and "shown in part" (P codes are left out) |
  | HCIS, Safe Work Australia | PubChem gives no licence; the site's documents are CC BY-NC | the source (shown only if there is no EU or ECHA entry: none in this sample) |
  | HSDB | US NLM: no restrictions; acknowledgement requested | the source |
  | PubChem itself | NCBI "places no restrictions"; depositors' terms apply (above) | "via PubChem, CID n" |
  | Pictograms (Wikimedia Commons: GHS-pictogram-explos, -flamme, -rondflam, -bottle, -acid, -skull, -exclam, -silhouette, -pollu .svg) | each page, checked for all nine: "ineligible for copyright and therefore in the public domain"; source "EPS file … from UNECE web site", converted | nothing required; THIRD-PARTY-NOTICES.md records the source |

- **The repo is public (MIT).** Recordings of PUG View contain ECHA's data, so THIRD-PARTY-NOTICES.md
  must give ECHA's terms for them (decision 9).
- **Server.** Apache proxies all of `<base>api/` (docs/server-setup.md), so a new endpoint needs
  no Apache change. It needs the API service restarted on deploy: deploy.sh already detects a
  pending restart and prints the `sudo systemctl restart` line for Jeff.

## Decisions (Jeff approved the plan on 2026-10-26, choosing every answer in bold)

1. **Where it shows: a Safety button in the header, after Get name, and the snapshot docked below
   the canvas** (one panel there at a time). Alternatives:
   - a button inside Get name's answer (two clicks);
   - a section of the properties panel. That is 280 px wide and computed offline without a click,
     whereas this sends the drawing only on a click.
2. **Which classification: one, never merged.** It is chosen in this order:
   - **the EU harmonised classification (CLP Annex VI) when PubChem has one.** It is the legally
     binding one, and GB CLP's mandatory list started from it;
   - **else the ECHA notified classification PubChem lists first** (the most company reports);
   - **else the first classification PubChem lists.**

   The others are counted and named, with the link (decision 3). Alternatives:
   - every pictogram and statement from every source (most cautious, but ethanol would then show
     "May cause cancer" from NITE);
   - every source in turn (long).
3. **A link to PubChem: yes, the same compound page Get name links to.** The link guard
   (web/config/requestPolicy.ts) already allows exactly that URL form, so it is unchanged.
   Invariant 1's words change from "the only such link is Get name's PubChem compound page" to
   "the only such links are a compound's PubChem page (Get name, Safety)". Alternative: CID as
   plain text only.
4. **The reminder, at the top of every result:** **"For learning only. This is a summary from
   PubChem, not a safety data sheet (SDS) or a risk assessment. Before you handle any chemical,
   read the supplier's SDS and your lab's COSHH risk assessment."** Please change the words as
   you like.
5. **Credit: one line per shown source, always visible in small type, plain text with no links**
   (invariant 1). ECHA's terms require the acknowledgement in each copy, so it isn't hidden
   behind a tick as the IR credit is.
   - EU: "Source: Regulation (EC) No 1272/2008 (CLP), Annex VI, entry ‹index no.›, EUR-Lex
     (https://eur-lex.europa.eu/eli/reg/2008/1272/oj), © European Union, CC BY 4.0; via PubChem,
     CID n."
   - ECHA: "Source: European Chemicals Agency, http://echa.europa.eu/. Notified classification
     (C&L Inventory) of ‹entry›, aggregated by PubChem, CID n."
   - Others: "Source: ‹SourceName›, ‹entry›, ‹URL›; via PubChem, CID n", with ", shown in part"
     for NITE-CMC.
6. **Other outcomes, and what they say:**
   - offline: the button is greyed, "Needs an internet connection". Nothing else works offline;
   - no GHS section (404): **"PubChem lists no GHS hazard classification for this compound (CID
     n). That does not mean it is safe. Another form of it (a salt, a hydrate, or a different
     stereoisomer or ring form) may have its own record."** With the reminder and the link;
   - "Not Classified": **"Not classified as hazardous by this source."**, then PubChem's own lines
     ("Reported as not meeting GHS hazard criteria by 946 of 969 companies …"), the credit and the
     others line;
   - no PubChem record (CID 0): "PubChem has no record of this exact structure, so it has no
     safety data for it.";
   - a reaction: "Safety works on structures, not reactions.";
   - busy, not responding or invalid: Get name's wording, except "not responding", which drops
     "Your drawing is safe" (confusing in a safety panel): "The lookup service isn't responding;
     try again in a minute."
7. **ECHA's percentages and note: shown as PubChem gives them.** The `Note` ("does not meet GHS
   hazard criteria for 65.1% … of all reports") goes above the statements. PubChem's summary
   lines go in a closed "About these notifications" disclosure. Alternative: leave the
   percentages out (simpler, but DMSO would look classified by everyone).
8. **Precautionary statements: left out.** PubChem gives only P codes. Their text would have to
   be typed in from the UN GHS annex, and the SDS has them.
9. **Recordings with ECHA's data stay in the public repo**, with ECHA's terms in
   THIRD-PARTY-NOTICES.md. Recordings are never edited, so they can't be trimmed to the shown
   source.
10. **Cache: 30 days on the server, like names.** The table holds the CID and the chosen
    classification (or "none"), nothing about who asked. Busy and unavailable answers are never
    stored.
11. **The test compounds** reuse Get name's recorded compounds, so no new SMILES lookups are
    needed. Please change the list:
    - EU: ethanol (10 others that disagree), caffeine (NITE disagrees), toluene (`H361d ***`,
      `H373 **`), boric acid (H360FD, two EU entries), nicotine, (R)-2-butanol (a stereo record
      with its own entry);
    - ECHA: DMSO (the 65.1% note), aspirin, paraquat dication (H301+H311, H301 twice, four
      pictograms), sodium benzoate;
    - not classified: glucose, L-alanine, cinnamic acid (a second ECHA entry disagrees);
    - none: aldehydo-D-glucose and tetramethylammonium;
    - no record: one invented structure (CID 0).

    The PUG View recordings come to about 1 MB.

## Design

- `server/ghs.py` (new, pure, no network):
  - `classifications(body)` reads PUG View's GHS section into a list in PubChem's order: source,
    entry, URL and index number, signal, pictograms, statements, "not classified" and notes;
  - `choose()` applies decision 2.

  Each statement is split into code, Annex VI note, share, words and class, and joining the parts
  back must give PubChem's string exactly. **Only the chosen classification must be well formed.**
  Anything unexpected in it (a pictogram outside GHS01–GHS09, a signal other than
  Danger/Warning, a statement that doesn't split, a missing reference) makes the answer
  "unavailable". A partial hazard list is never shown.
- `server/pubchem.py`: `PubChem.ghs(cid)` sends a GET through the same rate limit and retry. A 404
  `PUGVIEW.NotFound` gives None. Messages carry only status codes, as now.
- `server/cache.py`: a `hazards` table (cid, classification JSON or NULL, others JSON, stored_at),
  30 days.
- `server/main.py`: `POST /api/safety {smiles}`, beside `/api/name`. The SMILES is turned into a
  record through Get name's cache and lookup (one shared cache entry), then into the GHS answer.
  Errors are as for `/api/name`: 400 `invalid_structure`, 503 `busy`, 502 `unavailable`. The
  answer:
  `{found, cid, title, url, classification: null | {source: "eu"|"echa"|"other", source_name,
  entry, source_url, index_no, not_classified, signal, pictograms: [{code, name}], statements:
  [{code, annex_note, share, words, hazard_class}], notes: [..], summary: [..]}, others:
  {count, sources: [..]}}`.
- `server/scripts/record_ghs.py` records `recorded/pubchem/ghs-<slug>.json` through the server's
  client, for the names in `tests/fixtures/safety_names.txt`. It then builds
  `tests/fixtures/safety_responses.json` by replaying everything through the real app, as
  record_pubchem_names.py does.
- Web:
  - `api.ts`: `requestSafety()` and `safetyOutcome()`. Anything unexpected counts as not
    responding.
  - `panels/safety.ts`: the state, like naming.ts.
  - `SafetyButton.tsx` (header) and `SafetyPanel.tsx` + `safety.css`, docked with `Docked.tsx`.
  - `belowCanvas.ts` gains `'safety'`.
- `web/public/ghs/GHS01.svg` to `GHS09.svg`: Commons' files, fetched once into their own folder and
  checked before they are copied in. They are precached; CSP `img-src 'self'` already allows them.
- Guards:
  - the precache guard requires the nine images;
  - a new check fails an SVG with a script, an event handler, or a reference to anything outside
    itself;
  - `scripts/check_live.py` POSTs `api/safety` through Apache. It expects 200, found, the
    fixture's CID and source kind; not the content, which changes at PubChem.

## Acceptance bar

**A. The server (pytest; recordings replayed; no network)**
1. `record_ghs.py --offline` rebuilds `safety_responses.json` from the recordings through the real
   app, and a drift test byte-compares it.
2. The choice: for every recording, the chosen classification is the first EU one in PubChem's
   order, else the first ECHA one, else the first. `others` counts every other classification and
   names their sources once each, in order. The test finds the expected answer with its own walk
   of the raw recording (ReferenceNumbers and SourceNames), not with the parser.
3. Nothing lost or invented:
   - every statement of the chosen classification, joined back, equals PubChem's string;
   - pictogram codes equal the image URLs' file names, and names equal `Extra`;
   - the signal word and the notes are PubChem's strings.
4. Strictness: each rule in Design (`server/ghs.py`) has a negative test. Each test changes one
   field of a recording in memory, and the answer is 502 `unavailable`, never a partial list. A
   malformed classification that isn't chosen changes nothing.
5. CID 0 gives `found: false`, and PUG View is never asked: the replay transport fails on any
   request it has no recording for. A 404 `PUGVIEW.NotFound` gives `classification: null`. Any
   other 404 is unavailable.
6. 429/503 twice from either request gives 503 `busy`. Other failures give 502. Neither is cached.
   Both are forced with stub transports and fake sleep.
7. A second request for the same structure asks PubChem nothing. An answer, including "none", is
   kept 30 days by the fake clock and then asked for again.
8. Privacy: test_privacy covers the new route (it walks every route). A new test checks that a
   sentinel SMILES appears in no log line and no PubChem URL, and that the PUG View URL holds only
   the CID.

**B. In the browser (Playwright; the server's answers replayed from safety_responses.json)**
1. The Safety button sits after Get name. It is greyed:
   - offline ("Needs an internet connection");
   - with no atoms;
   - while asking.

   A reaction gets its message.
2. With the answer held, the panel says "Asking PubChem…" (`data-state=asking`). Released, it
   shows the snapshot.
3. For every test compound, the panel shows the fixture's answer exactly:
   - the signal word;
   - each pictogram, in order, as `<base>ghs/GHSnn.svg` with PubChem's name as its alt text and
     caption;
   - each statement's code, words, class and share;
   - the note, the credit for its source, and the "N more classifications" line.

   The test reads the fixture and types no values.
4. The reminder shows with every result: a classification, not classified, none listed, and no
   record.
5. Each outcome in decision 6 shows its words, on its test compound or on a forced server answer
   (busy, a 502, no answer before the deadline, invalid).
6. Any change to the drawing closes the panel. An answer for an older drawing is never shown: held,
   change, release.
7. Opening Safety closes the NMR preview, the stereoisomers and Practice, and each of them closes
   Safety.
8. The nine images are in the precache. The precache guard requires them, and the SVG check fails
   on a planted script, event handler or outside reference. Each guard has a negative test.
9. The only link out is the PubChem compound page. The credits contain no `<a>`. The request and
   link guards pass on every test.
10. Offline (an "offline:" smoke test): the button is greyed with its title, and no request goes to
    `api/safety`.

**C. Guards and docs**
1. AGENTS.md:
   - invariant 1's wording (decision 3);
   - invariant 3 names the GHS data as PubChem's, which it already is;
   - the Layout lines;
   - still at most 149 lines.
2. THIRD-PARTY-NOTICES.md lists the pictograms (public domain, Commons, from UNECE) and ECHA's
   terms for the recordings. CHANGELOG.md and BUILD-LEARNINGS.md are updated.
3. `check_live.py` checks `api/safety` through Apache (Design).
4. Every bug fix and guard has a test that fails without it. scripts/check.sh passes before each
   commit.
5. Commits are small, on branch `claude/v2-safety-snapshot`. No merge, push or deploy. The deploy
   needs the API service restarted (Jeff runs the sudo command deploy.sh prints).

## Known limits (to state in BUILD-LEARNINGS and, where useful, the panel)

- **The EU list, not GB's.** GB's mandatory classification list started from Annex VI, but the two
  may differ for substances changed since 2021. PubChem has only the EU list.
- **ECHA's notified entries** are companies' own classifications, and PubChem lists only codes
  above 10%.
- **Per record.** A salt, hydrate or other stereoisomer may have different data or none
  (aldehydo-D-glucose has none; D-glucose is "not classified").
- **Pure substances only.** A solution or a mixture is classified differently.
- **No precautionary statements.**
- **Timing.** Two PubChem requests, each with one retry, can outlast the browser's 8 s deadline
  when PubChem is slow. The student then sees "not responding".
- **Format changes.** If PubChem changes its format, lookups say "unavailable" rather than show
  part of a list.
- **HCIS** gives no licence through PubChem. It is credited, and shown only when there is no EU or
  ECHA entry.

## Done (2026-10-26, branch claude/v2-safety-snapshot, not merged or deployed)

- 7175688 is this plan. 663a0bc adds the server: `/api/safety`, server/ghs.py, the cache table,
  the recordings and the server tests. e7aa13e adds the Safety button and panel, the nine
  pictograms, the precache and SVG guards, the live checks and the docs. The last commit fixes the
  review's findings (below).
- Differences from the bar and the decisions, for Jeff to confirm:
  - Decision 5, the EU credit: it also gives the licence's URI, "CC BY 4.0
    (https://creativecommons.org/licenses/by/4.0/)", because CC BY 4.0 §3(a)(1)(C) asks for it.
    The entry is the Annex VI index number without the "[2]" PubChem adds to tell two entries
    apart.
  - The "N more classifications" line separates the sources with semicolons: one source's name
    has a comma in it ("Hazardous Chemical Information System (HCIS), Safe Work Australia").
  - C.3, the live check: it also requires the page's CSP and no-cache on `ghs/GHS07.svg`.
- Left for Jeff:
  - restart the API service after the deploy (deploy.sh prints the `sudo systemctl restart` line);
  - read the reminder (decision 4) and the credits on staging, and say if the wording should change;
  - say when the main session may merge, deploy to staging and promote.

## Review (2026-10-26)

A capped review: three reviewers (server, web, bar coverage and docs), then two skeptics who
tried to refute each finding. All were confirmed. Fixed, each with a test that fails without the
fix (shown by undoing the fix):
- high: tests/fixtures/safety_responses.json holds ECHA's data, but THIRD-PARTY-NOTICES.md gave
  ECHA's terms only for the recordings (docs only: the notice now names it, and the figures the
  plan and BUILD-LEARNINGS quote);
- medium: a hazard statement after "Not Classified" passed as a note; an entry with an item twice
  had no negative test; no test for a timeout on the GET, for the GET's rate limit, for ECHA
  winning over a source listed before it, for Safety's place after Get name, or for the EU
  credit's required parts (now with the licence URI); three strictness rules had no negative test;
- low, fixed anyway: an unhashable reference number gave a 500; a cached row written by another
  version gave a 500 (now a miss); the cache read-back was tested on three compounds (now every
  recorded entry); PubChem's "[2]" in the index number; the comma-separated sources; the ECHA
  credit's punctuation against decision 5; the Close test released its answer without waiting
  for the abort; the pictograms are pinned to their Commons files by SHA-256; the notice gives
  HCIS's and HSDB's terms; the SVG check is now an allowlist (a denylist missed prefixed elements,
  CDATA, CSS escapes and SMIL); a guard that could never fail (the statement round trip) is gone.

Accepted limits (low):
- AGENTS.md's Layout doesn't name src/pubchemPage.ts or panels/ghsPictograms.ts (149 of 149
  lines).
- The SVG check runs on the nine pictograms only, not on every SVG in the build: other features
  may ship SVGs that aren't plain shapes.
