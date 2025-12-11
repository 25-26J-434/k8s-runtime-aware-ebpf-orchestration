import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';

export function Navigation() {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <nav className="main-navigation">
            <div className="nav-container">
                <div className="nav-brand">
                    <div className="brand-text">
                        <div className="brand-title">Kernel Eye</div>
                        <div className="brand-subtitle">Runtime-Aware Telemetry</div>
                    </div>
                </div>

                <div className="nav-links">
                    <Link 
                        to="/" 
                        className={`nav-link ${isActive('/') ? 'active' : ''}`}
                    >
                        <span className="nav-link-text">Dashboard</span>
                    </Link>
                    
                    <Link 
                        to="/routing" 
                        className={`nav-link ${isActive('/routing') ? 'active' : ''}`}
                    >
                        <span className="nav-link-text">Routing</span>
                    </Link>
                    
                    <Link 
                        to="/scheduling" 
                        className={`nav-link ${isActive('/scheduling') ? 'active' : ''}`}
                    >
                        <span className="nav-link-text">Scheduling</span>
                    </Link>
                    
                    <Link 
                        to="/federation" 
                        className={`nav-link ${isActive('/federation') ? 'active' : ''}`}
                    >
                        <span className="nav-link-text">Federation</span>
                    </Link>
                </div>

                <div className="nav-status">
                    <div className="status-indicator"></div>
                    <span className="status-text">Live</span>
                </div>
            </div>
        </nav>
    );
}

