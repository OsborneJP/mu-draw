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
- The naming endpoints (POST /api/name, /api/structure) will add recordings here
  (PubChem structure-to-name, OPSIN), replayed with respx in pytest.
