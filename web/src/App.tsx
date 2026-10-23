import KetcherEditor from './editor/KetcherEditor';
import Header from './shell/Header';

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="workspace">
        <KetcherEditor />
      </main>
    </div>
  );
}
