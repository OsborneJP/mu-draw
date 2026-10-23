import KetcherEditor from './editor/KetcherEditor';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        <KetcherEditor />
      </main>
    </div>
  );
}
