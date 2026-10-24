// Keeps the properties panel in step with the drawing, with no timers: every change is
// looked at as Ketcher announces it, and RDKit (in its worker) works on at most one
// drawing at a time. Changes made meanwhile collapse into one request for the
// newest drawing, and a reply for a drawing that has since changed is never shown.
//
// Every ordering is forced in tracker.test.ts by holding and releasing the worker's
// replies. Measured (2026-10-24): about 3 ms per drawing in the worker for cholesterol, so
// the spec's ~300 ms debounce isn't needed.
import type { Computed } from './compute';
import { panelValues, type PanelValues } from './properties';

/** The drawing as the editor sees it at one moment (src/editor/drawing.ts). `badValence`
 * counts the atoms Ketcher underlines for valence; RDKit decides whether that matters. */
export type Drawing =
  | { kind: 'empty' | 'reaction' | 'not-elements' | 'unreadable' }
  | { kind: 'structure'; molfile: string; atomIds: number[]; badValence: number };

export interface WorkerRequest {
  id: number;
  molfile: string;
}

export type WorkerReply = { id: number; computed: Computed | null } | { failed: string };

/** A stereo element in Ketcher's own atom ids, for highlighting it. */
export interface StereoAtoms {
  atoms: number[];
  defined: boolean;
}

/** What the panel shows. `drawing` counts the drawing's changes: a ready state with
 * `revision !== drawing` describes an earlier drawing while a newer one is worked out. */
export type PanelState =
  | { kind: 'working' | 'unavailable' | 'empty' | 'reaction' | 'not-elements' | 'unreadable'; drawing: number }
  | { kind: 'invalid'; atoms: number; drawing: number }
  | {
      kind: 'ready';
      drawing: number;
      revision: number;
      /** Atoms in the drawing these values are for (explicit hydrogens included). */
      atoms: number;
      values: PanelValues;
      stereo: StereoAtoms[];
    };

export interface Tracker {
  /** The drawing changed (or, the first time, is there to be read). */
  changed(): void;
  /** A message from the RDKit worker. */
  reply(message: WorkerReply): void;
}

export function createTracker(
  read: () => Drawing,
  send: (request: WorkerRequest) => void,
  show: (state: PanelState) => void,
): Tracker {
  let drawing = 0;
  let inFlight: { revision: number; atomIds: number[]; badValence: number } | null = null;
  let newerWaiting = false; // the drawing changed while RDKit was busy
  let unavailable = false;
  let lastReady: Extract<PanelState, { kind: 'ready' }> | null = null;
  let showingLocal = true; // the panel shows a message, not lastReady

  function refresh() {
    const now = read();
    if (now.kind !== 'structure') {
      showingLocal = true;
      show({ ...now, drawing });
      return;
    }
    if (inFlight) {
      newerWaiting = true;
    } else {
      inFlight = { revision: drawing, atomIds: now.atomIds, badValence: now.badValence };
      send({ id: drawing, molfile: now.molfile });
    }
    show(lastReady && !showingLocal ? { ...lastReady, drawing } : { kind: 'working', drawing });
  }

  return {
    changed() {
      if (unavailable) return;
      drawing += 1;
      refresh();
    },
    reply(message) {
      if (unavailable) return;
      if ('failed' in message) {
        unavailable = true;
        show({ kind: 'unavailable', drawing });
        return;
      }
      const request = inFlight;
      if (!request || message.id !== request.revision) return;
      inFlight = null;
      if (request.revision === drawing) {
        if (message.computed) {
          const atomIds = request.atomIds;
          const toKetcher = (e: { atoms: number[]; defined: boolean }) => ({
            atoms: e.atoms.map((i) => atomIds[i]),
            defined: e.defined,
          });
          lastReady = {
            kind: 'ready',
            drawing,
            revision: request.revision,
            atoms: atomIds.length,
            values: panelValues(message.computed),
            stereo: [...message.computed.centres, ...message.computed.doubleBonds].map(toKetcher),
          };
          showingLocal = false;
          show(lastReady);
        } else {
          // RDKit can't read it. If Ketcher underlines atoms for valence, that's why (a
          // pentavalent carbon); otherwise say only that RDKit can't. Ketcher's warning
          // alone doesn't stop the values: it also underlines a sodium ion that a Molfile
          // gives an explicit valence of 0, which RDKit reads as the valid ion it is.
          showingLocal = true;
          show(
            request.badValence > 0
              ? { kind: 'invalid', atoms: request.badValence, drawing }
              : { kind: 'unreadable', drawing },
          );
        }
      }
      if (newerWaiting) {
        newerWaiting = false;
        refresh();
      }
    },
  };
}
