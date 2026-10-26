import KetcherEditor from './editor/KetcherEditor';
import NamePanel from './panels/NamePanel';
import NmrPanel from './panels/NmrPanel';
import PracticePanel from './panels/PracticePanel';
import PropertiesPanel from './panels/PropertiesPanel';
import StereoPanel from './panels/StereoPanel';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        {/* The canvas, with Get name's answer over it, and one panel docked below it:
            Practice, the NMR preview or the stereoisomers. */}
        <div className="canvas-area">
          <KetcherEditor />
          <NamePanel />
          <PracticePanel />
          <NmrPanel />
          <StereoPanel />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
