# The source of InChI and cairo as built into this app's Indigo

The app's Indigo WebAssembly file (indigo-ketcher 1.46.0) was built from Indigo's commit
b36d38f5293470721fe02ee570d9f0e6488a5b8d (github.com/epam/Indigo, tag indigo-1.46.0); its own version string ends
in -gb36d38f52. This archive holds, unchanged from that commit:

- third_party/inchi/: InChI 1.06, under the IUPAC/InChI-Trust InChI Licence No. 1.0
  (third_party/inchi/LICENCE).
- third_party/cairo/: cairo as of its upstream commit 06f405c775f46e29a7cc89b03fba9ab71a3f2623
  (2021-07-20; it calls itself 1.17.4), whose files are under the GNU Lesser General Public
  License 2.1 or, at the recipient's option, the Mozilla Public License 1.1. This app
  distributes cairo under the Mozilla Public License 1.1. Both texts, as cairo has them at
  that commit (gitlab.freedesktop.org/cairo/cairo), are in cairo-licences/.
- How they are built: third_party/CMakeLists.txt, api/wasm/indigo-ketcher/CMakeLists.txt and
  Indigo's CI configuration .github/workflows/indigo-ci.yaml (job build_indigo_ketcher, in
  the emscripten/emsdk:5.0.7 container), with Indigo's own LICENSE (Apache License 2.0).

## Files that differ from upstream

Compared with InChI v1.06 (github.com/IUPAC-InChI/InChI, commit a515b3973d08abe659d0de3e4def3d28d74eeb88)
and cairo's commit above. EPAM Systems changed them; Indigo's history at github.com/epam/Indigo
shows each change.

- third_party/cairo/boilerplate/cairo-boilerplate.h
- third_party/cairo/boilerplate/make-cairo-boilerplate-constructors.py
- third_party/cairo/src/cairo-compiler-private.h
- third_party/cairo/src/cairo-ft-font.c
- third_party/cairo/src/cairo-path-fill.c
- third_party/cairo/src/cairo-path-fixed.c
- third_party/cairo/src/cairo-path-in-fill.c
- third_party/cairo/src/cairo-path-stroke-polygon.c
- third_party/cairo/src/cairo-path-stroke-traps.c
- third_party/cairo/src/cairo-path-stroke-tristrip.c
- third_party/cairo/src/cairo-path-stroke.c
- third_party/cairo/src/cairo-rectangle.c
- third_party/cairo/src/cairo-scaled-font.c
- third_party/cairo/src/cairo-spline.c
- third_party/cairo/src/cairo-types-private.h
- third_party/cairo/src/cairo.h
- third_party/cairo/src/cairoint.h
- third_party/inchi/INCHI_BASE/src/ichicans.c
- third_party/inchi/INCHI_BASE/src/ichiparm.c
- third_party/inchi/INCHI_BASE/src/runichi4.c
- third_party/inchi/INCHI_BASE/src/util.c

## Files not upstream (added by EPAM Systems)

- third_party/cairo/CMakeLists.txt
- third_party/cairo/src/cairo-features.h.in
- third_party/inchi/CMakeLists.txt
- third_party/inchi/LICENCE
