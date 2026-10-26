import GroupButton from './editor/GroupButton';
import KetcherEditor from './editor/KetcherEditor';
import FormsPanel from './panels/FormsPanel';
import NamePanel from './panels/NamePanel';
import NmrPanel from './panels/NmrPanel';
import PracticePanel from './panels/PracticePanel';
import ProtonNmrPanel from './panels/ProtonNmrPanel';
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
            Practice, an NMR preview (¹³C or ¹H), the stereoisomers, the tautomers or the
            resonance structures. */}
        <div className="canvas-area">
          <KetcherEditor />
          <GroupButton />
          <NamePanel />
          <PracticePanel />
          <NmrPanel />
          <ProtonNmrPanel />
          <StereoPanel />
          <FormsPanel kind="tautomers" />
          <FormsPanel kind="resonance" />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
