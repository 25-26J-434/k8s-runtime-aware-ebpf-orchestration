import { Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { Dashboard } from './pages/Dashboard';
import { Routing } from './pages/Routing';
import { Scheduling } from './pages/Scheduling';
import { Federation } from './pages/Federation';
import './App.css';

function App() {
    return (
        <div className="app">
            <Navigation />
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/routing" element={<Routing />} />
                <Route path="/scheduling" element={<Scheduling />} />
                <Route path="/federation" element={<Federation />} />
            </Routes>
        </div>
    );
}

export default App;
