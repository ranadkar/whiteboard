import './App.css';
import Whiteboard from './components/Whiteboard';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>BOARD</h1>
        <p>draw in real time :)</p>
      </header>
      <main>
        <Whiteboard />
      </main>
      <footer>
        <p>Open this page in multiple windows and see what happens</p>
      </footer>
    </div>
  );
}

export default App;
