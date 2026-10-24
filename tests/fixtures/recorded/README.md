# Recorded responses

No test touches the network. Tests that need PubChem or OPSIN replay these files.

Layout: `<service>/<kind>-<slug>.json`, for example `pubchem/name-aspirin.json`.
Each file is one HTTP exchange, exactly as received:

```json
{
  "request": {"method": "GET", "url": "https://pubchem.ncbi.nlm.nih.gov/rest/pug/..."},
  "recorded_at": "2026-10-23T16:12:00Z",
  "status": 200,
  "body": { "...": "parsed JSON response, unedited" }
}
```

Rules:
- Record with a script, never by hand, and never edit a recording. To change one,
  re-record it and commit the script run.
- Current recordings: `pubchem/name-*.json`, made by `scripts/fetch_reference_smiles.py`
  (PUG REST `compound/name/{name}/property/SMILES,Title/JSON`). They are the source of
  tests/fixtures/reference_compounds.csv.
- `pubchem/smiles-*.json`, made by `server/scripts/record_pubchem_names.py` through the
  server's own PubChem client (PUG REST POST `compound/smiles/property/IUPACName,Title/JSON`,
  the canonical SMILES in the form body, kept under `request.form`). One per Get name test
  compound: every reference compound and the 3 invented structures (answered `CID 0`).
  pytest replays them with `httpx.MockTransport` (`replay()` in that script), and the same
  script rebuilds tests/fixtures/name_responses.json, the server's answers that the browser
  tests replay.
- Name to structure (POST /api/structure) will add OPSIN and PubChem name recordings.
