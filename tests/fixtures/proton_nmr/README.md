# ¹H NMR preview fixtures

- `compounds.json`, `*.mol`: the test compounds' structures, from PubChem by name
  (`proton_nmr_names.txt`), written by `server/scripts/gen_reference_expected.py` with each
  compound's classes of atoms carrying H, its number of H, and its diastereotopic CH₂, all
  from server-side RDKit.
- `excerpt.sd`: the test compounds' records from NMRShiftDB2's
  `nmrshiftdb2withsignals.sd`, verbatim, and `reference_spectra.json`, their measured ¹H
  shifts, both written by `web/scripts/build-proton-table.ts` (which also leaves these
  compounds out of the shift table). Contains information from nmrshiftdb2
  (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database
  License (`web/public/nmr/LICENSE-nmrshiftdb2.txt`;
  https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt).
- `expected.json`: the signal count for each compound, by judgement (provisional).
- `outliers.json`: the predicted C–H signals more than 0.3 ppm from the measured shift, and
  every exchangeable (OH, NH) signal's error, recorded so they are not hidden;
  `web/scripts/protonNmr.test.ts` fails if the predictions change.
