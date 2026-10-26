// The 3D view's viewer (docs/plans/v2-3d-view.md): 3Dmol.js, in its own chunk that is fetched
// the first time a model is shown (and precached for later), drawing one model in one of
// three styles, with the look ProteinFirst uses for small molecules (decision 1): white
// background, Jmol colours. 3Dmol arrives asynchronously, so a viewer closed before it
// arrives is never made; viewer3d.test.ts holds the module to force that ordering.
//
// 3Dmol renders into one shared offscreen WebGL context and copies each frame to its canvas,
// so opening many models doesn't use up the browser's WebGL contexts. Without WebGL it only
// logs an error, so the browser is asked first. The viewer is kept on its element as
// `viewer3d` so the browser tests can read the model back from 3Dmol itself.
import type { AtomStyleSpec, GLViewer } from '3dmol';

export type Style = 'ball-and-stick' | 'sticks' | 'space-filling';

export interface Look {
  style: Style;
  hydrogens: boolean;
}

export const FIRST_LOOK: Look = { style: 'ball-and-stick', hydrogens: true };

export const STYLES: Record<Style, AtomStyleSpec> = {
  'ball-and-stick': { stick: { radius: 0.15, colorscheme: 'Jmol' }, sphere: { scale: 0.25, colorscheme: 'Jmol' } },
  sticks: { stick: { radius: 0.2, colorscheme: 'Jmol' } },
  'space-filling': { sphere: { colorscheme: 'Jmol' } },
};

export type ViewerProblem = 'no-webgl' | 'unavailable';

/** The parts of 3Dmol used here (a stand-in in viewer3d.test.ts). */
export interface ThreeDmol {
  createViewer(element: HTMLElement, config: { backgroundColor: string; antialias: boolean }): GLViewer;
}

export interface ViewerDeps {
  load: () => Promise<ThreeDmol>;
  hasWebgl: () => boolean;
  /** The model is drawn; or it can't be, and why. */
  onShown: () => void;
  onProblem: (problem: ViewerProblem) => void;
}

export interface Viewer {
  setLook(look: Look): void;
  /** Back to the first view: the model as it was first shown. */
  reset(): void;
  close(): void;
}

export function browserHasWebgl(): boolean {
  const canvas = document.createElement('canvas');
  return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
}

export const browserDeps = (onShown: () => void, onProblem: (problem: ViewerProblem) => void): ViewerDeps => ({
  load: () => import('3dmol'),
  hasWebgl: browserHasWebgl,
  onShown,
  onProblem,
});

function apply(viewer: GLViewer, look: Look): void {
  viewer.setStyle({}, STYLES[look.style]);
  if (!look.hydrogens) viewer.setStyle({ elem: 'H' }, {});
}

/** Show `molblock` (a 3D Molfile) in `element`, in `look`. */
export function showModel(element: HTMLElement, molblock: string, look: Look, deps: ViewerDeps): Viewer {
  let viewer: GLViewer | null = null;
  let firstView: number[] | null = null;
  let wanted = look;
  let closed = false;

  if (!deps.hasWebgl()) deps.onProblem('no-webgl');
  else
    deps.load().then(
      ($3Dmol) => {
        if (closed) return;
        viewer = $3Dmol.createViewer(element, { backgroundColor: 'white', antialias: true });
        viewer.addModel(molblock, 'sdf');
        apply(viewer, wanted);
        viewer.zoomTo();
        firstView = viewer.getView();
        viewer.render();
        Object.defineProperty(element, 'viewer3d', { value: viewer, configurable: true });
        deps.onShown();
      },
      () => {
        if (!closed) deps.onProblem('unavailable');
      },
    );

  return {
    setLook(next) {
      wanted = next;
      if (!viewer) return;
      apply(viewer, next);
      viewer.render();
    },
    reset() {
      if (!viewer || !firstView) return;
      viewer.setView(firstView);
      viewer.render();
    },
    close() {
      closed = true;
      if (!viewer) return;
      viewer.clear();
      delete (element as { viewer3d?: GLViewer }).viewer3d;
      viewer = null;
    },
  };
}
