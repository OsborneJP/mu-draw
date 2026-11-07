# Version 1 hand checks, on Windows 11 and macOS

Rendered by `python scripts/build_hand_checks.py` from the generated fixtures; do not
edit by hand. It covers the boxes still open in docs/SPEC.md's Testing checklist
(docs/plans/v1-release.md, bar A).

Do each check twice: on a Windows 11 laptop (Chrome or Edge) and on a Mac (Chrome),
in the app installed from:

    https://osbornelab.manchester.edu/draw/

Then tell Claude what you saw: "all pass on both", or the step and platform that
didn't.

**To put a structure on the canvas,** copy its SMILES from this sheet, click an empty
part of the canvas, press Ctrl+V (⌘V on a Mac), and click to place it. If the browser
asks to see what you copied, allow it. Clear the canvas between compounds with
Ketcher's Clear Canvas button.

## 1. Properties match server-side RDKit

Box: *Properties match server-side RDKit for the 10 reference compounds* (and
(E)-cinnamic acid, added on 2026-10-23).

Paste each structure and compare the Properties panel with its row. The values are
server-side RDKit 2026.09.1's, rounded as the panel rounds them.

| Compound | SMILES to paste |
| --- | --- |
| aspirin | `CC(=O)OC1=CC=CC=C1C(=O)O` |
| ibuprofen | `CC(C)CC1=CC=C(C=C1)C(C)C(=O)O` |
| caffeine | `CN1C=NC2=C1C(=O)N(C(=O)N2C)C` |
| glucose | `C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O` |
| paracetamol | `CC(=O)NC1=CC=C(C=C1)O` |
| benzoic acid | `C1=CC=C(C=C1)C(=O)O` |
| nicotine | `CN1CCC[C@H]1C2=CN=CC=C2` |
| cholesterol | `C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C` |
| (R)-2-butanol | `CC[C@@H](C)O` |
| aldehydo-D-glucose | `C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O` |
| (E)-cinnamic acid | `C1=CC=C(C=C1)/C=C/C(=O)O` |

| Compound | Formula | Average MW (g/mol) | Exact mass | Degree of unsaturation | H-bond donors | H-bond acceptors | Rotatable bonds | TPSA (Å²) | logP | Lipinski |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aspirin | C9H8O4 | 180.16 | 180.0423 | 6 | 1 | 4 | 2 | 63.6 | 1.31 | all 4 |
| ibuprofen | C13H18O2 | 206.28 | 206.1307 | 5 | 1 | 2 | 4 | 37.3 | 3.07 | all 4 |
| caffeine | C8H10N4O2 | 194.19 | 194.0804 | 6 | 0 | 6 | 0 | 61.8 | -1.03 | all 4 |
| glucose | C6H12O6 | 180.16 | 180.0634 | 1 | 5 | 6 | 1 | 110.4 | -3.22 | all 4 |
| paracetamol | C8H9NO2 | 151.16 | 151.0633 | 5 | 2 | 3 | 1 | 49.3 | 1.35 | all 4 |
| benzoic acid | C7H6O2 | 122.12 | 122.0368 | 5 | 1 | 2 | 1 | 37.3 | 1.38 | all 4 |
| nicotine | C10H14N2 | 162.24 | 162.1157 | 5 | 0 | 2 | 1 | 16.1 | 1.85 | all 4 |
| cholesterol | C27H46O | 386.66 | 386.3549 | 5 | 1 | 1 | 5 | 20.2 | 7.39 | fails logP |
| (R)-2-butanol | C4H10O | 74.12 | 74.0732 | 0 | 1 | 1 | 1 | 20.2 | 0.78 | all 4 |
| aldehydo-D-glucose | C6H12O6 | 180.16 | 180.0634 | 1 | 5 | 6 | 5 | 118.2 | -3.38 | all 4 |
| (E)-cinnamic acid | C9H8O2 | 148.16 | 148.0524 | 6 | 1 | 2 | 2 | 37.3 | 1.78 | all 4 |

## 2. Stereocentre count

Box: *Stereocenter count: 2-butanol shows 1; open-chain glucose shows 4, up to 16
stereoisomers.* Paste each (SMILES in section 1) and read the panel's Stereochemistry.

| Compound | Stereocenters | Stereogenic double bonds | Undefined | Stereoisomers, at most |
| --- | --- | --- | --- | --- |
| (R)-2-butanol | 1 | 0 | 0 | 2 |
| aldehydo-D-glucose | 4 | 0 | 0 | 16 |

## 3. Get name

Box: *Get name: 20 known compounds correct, 3 invented structures give the not-found
message.* Paste each structure, then press **Get name** in the header. PubChem may have
retitled a compound since these answers were recorded; the same CID is what matters.
Where the drawing leaves stereochemistry undefined, a note under the name says at how
many places (the last column).

| Compound | SMILES to paste | IUPAC name | PubChem title | CID | Undefined stereo |
| --- | --- | --- | --- | --- | --- |
| aspirin | `CC(=O)OC1=CC=CC=C1C(=O)O` | 2-acetyloxybenzoic acid | Aspirin | 2244 | none |
| ibuprofen | `CC(C)CC1=CC=C(C=C1)C(C)C(=O)O` | 2-[4-(2-methylpropyl)phenyl]propanoic acid | Ibuprofen, (+-)- | 3672 | 1 |
| caffeine | `CN1C=NC2=C1C(=O)N(C(=O)N2C)C` | 1,3,7-trimethylpurine-2,6-dione | Caffeine | 2519 | none |
| glucose | `C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O` | (3R,4S,5S,6R)-6-(hydroxymethyl)oxane-2,3,4,5-tetrol | D-Glucose | 5793 | 1 |
| paracetamol | `CC(=O)NC1=CC=C(C=C1)O` | N-(4-hydroxyphenyl)acetamide | Acetaminophen | 1983 | none |
| benzoic acid | `C1=CC=C(C=C1)C(=O)O` | benzoic acid | Benzoic Acid | 243 | none |
| nicotine | `CN1CCC[C@H]1C2=CN=CC=C2` | 3-[(2S)-1-methylpyrrolidin-2-yl]pyridine | Nicotine | 89594 | none |
| cholesterol | `C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C` | (3S,8S,9S,10R,13R,14S,17R)-10,13-dimethyl-17-[(2R)-6-methylheptan-2-yl]-2,3,4,7,8,9,11,12,14,15,16,17-dodecahydro-1H-cyclopenta[a]phenanthren-3-ol | Cholesterol | 5997 | none |
| (R)-2-butanol | `CC[C@@H](C)O` | (2R)-butan-2-ol | (-)-2-Butanol | 84682 | none |
| aldehydo-D-glucose | `C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O` | (2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal | (2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal | 107526 | none |
| (E)-cinnamic acid | `C1=CC=C(C=C1)/C=C/C(=O)O` | (E)-3-phenylprop-2-enoic acid | Cinnamic Acid | 444539 | none |
| ethanol | `CCO` | ethanol | Ethanol | 702 | none |
| acetone | `CC(=O)C` | propan-2-one | Acetone | 180 | none |
| ethyl acetate | `CCOC(=O)C` | ethyl acetate | Ethyl Acetate | 8857 | none |
| toluene | `CC1=CC=CC=C1` | toluene | Toluene | 1140 | none |
| pyridine | `C1=CC=NC=C1` | pyridine | Pyridine | 1049 | none |
| (S)-2-butanol | `CC[C@H](C)O` | (2S)-butan-2-ol | (+)-2-Butanol | 444683 | none |
| L-alanine | `C[C@@H](C(=O)O)N` | (2S)-2-aminopropanoic acid | L-Alanine | 5950 | none |
| maleic acid | `C(=C\C(=O)O)\C(=O)O` | (Z)-but-2-enedioic acid | Maleic Acid | 444266 | none |
| aniline | `C1=CC=C(C=C1)N` | aniline | Aniline | 6115 | none |

Each of these invented structures should say: "PubChem has no record of this exact structure, so no name is available."

| Made from | SMILES to paste |
| --- | --- |
| cholesterol + caffeine | `CC(CCC[C@@H](C)[C@H]1CC[C@H]2[C@@H]3CC=C4C[C@@H](O)CC[C@]4(C)[C@H]3CC[C@]12C)CCn1c(=O)c2c(ncn2C)n(C)c1=O` |
| nicotine + ibuprofen | `CC(CCN1CCC[C@H]1c1cccnc1)Cc1ccc(C(C)C(=O)O)cc1` |
| aspirin + (E)-cinnamic acid | `O=C(C/C(=C\c1ccccc1)C(=O)O)Oc1ccccc1C(=O)O` |

## 4. Name to structure: Add, Replace, and the round trip

Box: *Name to structure: Add and Replace both work, and the round trip shows PubChem's
name next to the typed name.*

1. Paste aspirin (`CC(=O)OC1=CC=CC=C1C(=O)O`).
2. Type `caffeine` in the header's Name to structure box and press **Add**. The
   structure follows the pointer; click to place it. The canvas has both.
3. Type `ibuprofen` and press **Replace**. The canvas has only ibuprofen.
4. The Name panel shows *You typed* with what you typed, and *PubChem's IUPAC name*
   beside it: "2-[4-(2-methylpropyl)phenyl]propanoic acid".
5. Type PubChem's own name for aspirin, `2-acetyloxybenzoic acid`, and press
   **Replace**. The two names match, so a ✓ follows PubChem's name.

## 5. (R)- and (S)-2-butanol

Box: *Stereo: (R)- and (S)-2-butanol give different names and draw with the right
wedges.*

Type each name in Name to structure and press **Replace**. Check by eye that the wedge
gives the configuration named, and that the panel shows PubChem's name:

| Typed | PubChem's IUPAC name | CID |
| --- | --- | --- |
| `(R)-2-butanol` | (2R)-butan-2-ol | 84682 |
| `(S)-2-butanol` | (2S)-butan-2-ol | 444683 |

Then paste each one's SMILES and press **Get name**: the same two names.

| Compound | SMILES to paste |
| --- | --- |
| (R)-2-butanol | `CC[C@@H](C)O` |
| (S)-2-butanol | `CC[C@H](C)O` |

## 6. Offline

Box: *Offline: properties, functional groups and export all work; naming buttons show
the offline message.*

1. In the installed app, paste aspirin, then turn Wi-Fi off. The header says
   **Offline**.
2. Change the drawing (add a carbon): the Properties panel follows it.
3. Tick **Show functional groups**: the groups are listed and coloured on the drawing.
4. **Export** saves a PNG and an SVG; **Copy image** pastes into Word.
5. **Predict ¹³C NMR** still shows a spectrum (the NMR section's "Option A only" box
   doesn't apply: the prediction is built into the app; docs/plans/v1-release.md,
   decision 1).
6. **Get name**, the Name to structure box with **Add** and **Replace**, **Safety** and
   **Show in 3D** are greyed, and each says "Needs an internet connection" (Show in 3D under
   the button, the others when you hover over them).
7. Turn Wi-Fi back on: they work again.

## 7. The update banner

Box: *Publishing a new build shows the update banner on next launch, and in an open
app when the student returns to it or it comes back online.*

This needs Claude to publish a new build while you watch, so it is done with the two
deploys that are coming anyway: the review's fixes, then 1.0.0.

| Deploy | Windows 11 | Mac |
| --- | --- | --- |
| The review's fixes | App open: switch to another window, then back | App closed: launch it |
| 1.0.0 | App closed: launch it | App open with Wi-Fi off: turn Wi-Fi on |

Each time, tell Claude when the apps are ready; Claude deploys and says when it's live.
Then the banner says "An update is ready. Reload to use it." The drawing stays as it
was until you click **Reload**; after it, the drawing is still there, and after the
second deploy About shows Version 1.0.0.
