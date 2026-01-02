import { Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Topology } from './pages/Topology';
import { Routing } from './pages/Routing';
import { Scheduling } from './pages/Scheduling';
import { Federation } from './pages/Federation';
import './App.css';

function App() {
    return (
        <Routes>
            <Route path="/" element={
                <div style={{ marginLeft: 0, width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0 }}>
                    <Landing />
                </div>
            } />
                <Route path="/dashboard" element={
                    <div className="app">
                        <Navigation />
                        <Dashboard />
                    </div>
                } />
                <Route path="/topology" element={
                    <div className="app">
                        <Navigation />
                        <Topology />
                    </div>
                } />
                <Route path="/routing" element={
                    <div className="app">
                        <Navigation />
                        <Routing />
                    </div>
                } />
                <Route path="/scheduling" element={
                    <div className="app">
                        <Navigation />
                        <Scheduling />
                    </div>
                } />
                <Route path="/federation" element={
                    <div className="app">
                        <Navigation />
                        <Federation />
                    </div>
                } />
            </Routes>
    );
}

export default App;
