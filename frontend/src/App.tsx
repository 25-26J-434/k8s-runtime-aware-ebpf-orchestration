import { Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Topology } from './pages/Topology';
import { Routing } from './pages/Routing';
import { Scheduling } from './pages/Scheduling';
import { ScalingRules as Scalings } from './pages/ScalingRules';
import { Deployments } from './pages/Deployments';
import { Federation } from './pages/Federation';
import './App.css';

function App() {
    return (
        <div className="app">
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/dashboard" element={
                    <>
                        <Navigation />
                        <Dashboard />
                    </>
                } />
                <Route path="/topology" element={
                    <>
                        <Navigation />
                        <Topology />
                    </>
                } />
                <Route path="/routing" element={
                    <>
                        <Navigation />
                        <Routing />
                    </>
                } />
                <Route path="/scheduling" element={
                    <>
                        <Navigation />
                        <Scheduling />
                    </>
                } />
                <Route path="/scaling" element={
                    <>
                        <Navigation />
                        <Scalings />
                    </>
                } />
                <Route path="/deployments" element={
                    <>
                        <Navigation />
                        <Deployments />
                    </>
                } />
                <Route path="/federation" element={
                    <>
                        <Navigation />
                        <Federation />
                    </>
                } />
            </Routes>
        </div>
    );
}

export default App;
