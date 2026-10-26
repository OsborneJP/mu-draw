# Grouping items to arrange them together (plan, approved by Jeff on 2026-10-26)

Jeff asked on 2026-10-26: "can we add a grouping feature, allowing us to group multiple items
together for arranging on the page". As in ChemDraw: the student selects several items, groups
them, and from then on a click on any of them picks up the whole group, which moves, rotates
and deletes as one.

## What a student sees

1. Select two or more items (drag a box with the select tool, or Shift+click). A **Group**
   button appears beside the selection.
2. Grouped, a click on any member with the select tool selects the whole group; dragging moves
   it all, the rotate handle turns it all, Delete removes it all.
3. With a group selected, the button says **Ungroup**.
4. Drawing tools still work on single atoms and bonds inside a group (adding a bond to one
   molecule of a group, for example). An atom added to a grouped molecule belongs to the group.

## Measured (Ketcher 3.18, in the app; a throwaway Playwright probe)

- Ketcher has no grouping of its own. Its Ctrl+G is "S-Group": chemistry groupings
  (superatoms, data groups), not objects on the page.
- Ketcher's `editor.selection()` sets the selection, and its `selectionChange` event fires
  when the student presses on an item. Extending the selection there to a whole group works
  with a drag: pressing on one atom of one molecule and dragging moved both molecules of a
  two-molecule group by exactly the same offset.
- Ketcher drops anything it doesn't know when it writes a drawing: a property on a molecule
  node and extra keys at the top of the KET were both gone after a round trip. So the app keeps
  the groups itself, beside the drawing; no file format Ketcher writes (KET, Molfile, CDXML,
  SMILES) can carry them.
- The autosave keeps the drawing (KET) in this browser's localStorage; the groups can be kept
  beside it, written in the same step.

## Decisions for Jeff (proposed answers in bold)

1. **Where the command is: a small floating Group / Ungroup button beside the selection**,
   like Ketcher's own rotate handle. The alternative is a header button, but the header is
   already full on phones. ChemDraw's Ctrl+G stays Ketcher's S-Group (students rarely use it);
   **no keyboard shortcut** for now.
2. **What can be grouped: everything on the canvas**: whole molecules, text, reaction arrows,
   + signs, shapes and images (such as glassware). A molecule always joins whole (all its
   atoms), never part of one.
3. **Kept with the drawing in this browser (autosave and relaunch), but not in files.**
   Save, Copy and Export keep the items and their positions but not the grouping, and a file
   opened later has no groups. Ketcher's formats have no place for it (measured). The
   alternative, a warning on Save, seems more noise than help.
4. **Undo**: moving, rotating or deleting a group is one Undo step, as for any selection,
   and Undo of a delete brings the group back with its items. Group and Ungroup themselves
   are not Ketcher edits, so **Undo does not undo them**; Ungroup does.
5. **No nesting**: grouping items that include a group makes one flat group.

## Acceptance bar

1. With two molecules, a text and an arrow selected, Group makes a group; the button then says
   Ungroup. A click on any one member with the select tool selects all four (Playwright reads
   Ketcher's selection).
2. Dragging one member moves every member by the same offset, as one Undo step; rotating and
   deleting act on all members (Playwright, from Ketcher's coordinates).
3. Ungroup ends it: a click then selects only the item clicked.
4. A bond drawn onto a grouped molecule joins the group: dragging the group moves the new atom
   too.
5. Groups survive an autosave and a relaunch, and are cleared when the drawing is replaced (an
   opened file, Clear Canvas, Name to structure's Replace). A pure Vitest covers the store:
   members kept, remapped and dropped.
6. Every ordering is forced in the tests: a change event arriving while the selection is being
   extended, and Undo right after a group move.
7. Nothing else changes: with no groups, selection and dragging behave exactly as before (the
   existing smoke tests pass unchanged).

## Found while building (2026-10-26)

- Ketcher scales a drawing it loads (its bonds to an average length of 1, about the origin;
  images keep their place) and moves it to the middle of the window. So positions saved
  before a relaunch are found again after the same change, worked out from the average bond
  length and the centre of the drawing saved with them, not at the same numbers. The
  relaunch test stretches a bond and changes the window size to force both.
- Ketcher's Undo brings a deleted item back under its old id, and ids are never reused in
  one drawing; so a group keeps the ids of members that have gone, and a group with fewer
  than two left does nothing until they come back.

- Ketcher puts a new drawing object in place not only for Open, Clear Canvas and setMolecule
  (Name to structure's Replace, Practice) but also for Aromatize, Dearomatize, Calculate CIP,
  explicit H, Clean Up, Layout and Settings; Undo and Redo put the earlier object back. The
  first version took every new object for a new drawing and dropped all groups (review round
  1). Now each drawing object keeps its groups for Undo and Redo, and a new one gets the
  groups found whole on it after the same change of scale and place as a relaunch: an edit
  that only rescales or moves the whole drawing keeps them; a different drawing, or one whose
  items moved one by one, ends them. (Layout on the test drawing, which has a reaction arrow,
  moved everything together: its group stayed.)
- Ketcher's double-click edits every selected atom or bond, and the press before it has
  selected the group; so a double-click on an atom or bond of a group first selects that one
  alone (round 1: changing one carbon to N changed the whole group).

## Review (round 1, 2026-10-26)

Three reviewers against this bar, each high or medium finding put to a skeptic. Confirmed
(all medium) and fixed, each with a test that fails on e55b2ab: groups dropped by Ketcher's
in-place edits and not brought back by their Undo; a restored group held one atom per
molecule; a double-click on a grouped atom edited the whole group; the Clear Canvas test
passed without clearing. Lows fixed: images restored with the wrong shift when Ketcher had
moved the drawing since its last save; Group takes in a group doing nothing, so no item is in
two groups; the button keeps the focus off itself (Ketcher's keys work straight after it) and
sits clear of the zoom control when not beside the floating tools; Group redraws Ketcher's
rotate frame; two restore tests could not fail. Lows accepted (below, and): the Undo button's
wait in the move test is always already met; the browser tests press on atom 0 (the unit
tests cover the other kinds of member).

## Known limits

- Groups live only in this browser with the drawing; files, copies and exports don't carry
  them.
- A group isn't shown on the canvas until it is clicked (ChemDraw doesn't outline them either).
- Shift+click can't take one group out of a larger selection: the rest of the group puts it
  back. Click the canvas and select again.
- Clean Up, Layout and explicit H keep a group only if they leave all of it where the
  drawing's change of scale and place puts it; a group whose items they move one by one ends
  (Undo brings it back). In the test drawing (with a reaction arrow) Layout moved everything
  together and the group stayed. Undo or Redo past such an edit gives that drawing the groups
  it had then, so a Group or Ungroup made since is undone with it.
- With a group selected, an element or bond type picked in the toolbar changes every atom or
  bond in it, as for any selection in Ketcher.
- With the ¹³C NMR preview open, a click on a carbon of a grouped molecule selects the whole
  group, so it no longer picks out that carbon's peak.
- In the test browser, Ketcher 3.18 can't turn a selection that holds a text with its rotate
  handle (it stops after moving the text), group or no group. The rotate test uses a group
  without text; worth checking in a real browser.
