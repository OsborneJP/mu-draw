import { useRef, useState, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { SCALES, savePng, saveSvg, type Outcome, type Scale } from './exportImage';
import './export.css';
import { countUse } from '../usage/start';

const EXPORT_EMPTY = 'Nothing to export: the drawing is empty.';
const EXPORT_FAILED = "Couldn't make the image. If the drawing is very large, try a smaller size.";

// Export: download the drawing as a PNG (1x, 2x or 4x, white or transparent) or an SVG.
// Made on the device; works offline.
export default function ExportDialog() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const dialog = useRef<HTMLDialogElement>(null);
  const [scale, setScale] = useState<Scale>(2);
  const [transparent, setTransparent] = useState(false);
  const [message, setMessage] = useState('');

  async function run(save: () => Promise<Outcome>) {
    countUse('export');
    setMessage('');
    try {
      if ((await save()) === 'empty') setMessage(EXPORT_EMPTY);
    } catch (error) {
      console.error('Export failed:', error);
      setMessage(EXPORT_FAILED);
    }
  }

  return (
    <>
      <button
        type="button"
        className="header-button"
        data-testid="app-export-button"
        disabled={!ketcher}
        onClick={() => {
          setMessage('');
          dialog.current?.showModal();
        }}
      >
        Export
      </button>
      <dialog ref={dialog} className="export-dialog" aria-labelledby="export-title">
        <h2 id="export-title">Export image</h2>
        <fieldset>
          <legend>PNG size</legend>
          {SCALES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="png-scale"
                checked={scale === option}
                onChange={() => setScale(option)}
              />
              {option}x
            </label>
          ))}
        </fieldset>
        <label>
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          Transparent background (PNG)
        </label>
        <div className="export-actions">
          <button type="button" onClick={() => ketcher && void run(() => savePng(ketcher, scale, transparent))}>
            Download PNG
          </button>
          <button type="button" onClick={() => ketcher && void run(() => saveSvg(ketcher))}>
            Download SVG
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <p role="status" className="export-message" data-testid="export-message">
          {message}
        </p>
      </dialog>
    </>
  );
}
