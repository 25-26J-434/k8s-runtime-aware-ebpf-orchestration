import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';

export function Landing() {
    const navigate = useNavigate();
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const totalDuration = 8000;
        const intervalTime = 50;
        const steps = totalDuration / intervalTime;

        let currentStep = 0;
        const progressInterval = setInterval(() => {
            currentStep++;
            setProgress(Math.min(100, (currentStep / steps) * 100));

            if (currentStep >= steps) {
                clearInterval(progressInterval);
                navigate('/dashboard');
            }
        }, intervalTime);

        return () => clearInterval(progressInterval);
    }, [navigate]);

    return (
        <div className="landing-page">
            <div className="landing-background">
                <div className="landing-gradient"></div>
                <div className="landing-grid"></div>
                
                {/* Tech Grid Lines */}
                <div className="tech-grid-container">
                    <svg className="tech-grid-svg" width="100%" height="100%">
                        <defs>
                            <linearGradient id="gridGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="rgba(59, 130, 246, 0.1)" />
                                <stop offset="50%" stopColor="rgba(139, 92, 246, 0.1)" />
                                <stop offset="100%" stopColor="rgba(59, 130, 246, 0.1)" />
                            </linearGradient>
                        </defs>
                        <pattern id="gridPattern" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
                            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="url(#gridGradient)" strokeWidth="1" opacity="0.3"/>
                        </pattern>
                        <rect width="100%" height="100%" fill="url(#gridPattern)" />
                    </svg>
                </div>

                {/* Animated Data Nodes */}
                <div className="data-nodes">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div 
                            key={i} 
                            className="data-node" 
                            style={{
                                left: `${15 + (i % 4) * 25}%`,
                                top: `${20 + Math.floor(i / 4) * 40}%`,
                                animationDelay: `${i * 0.5}s`
                            }}
                        >
                            <div className="node-pulse"></div>
                            <div className="node-core"></div>
                        </div>
                    ))}
                </div>

                {/* Connection Lines */}
                <svg className="connection-lines" width="100%" height="100%">
                    <defs>
                        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="rgba(59, 130, 246, 0.3)" />
                            <stop offset="50%" stopColor="rgba(139, 92, 246, 0.3)" />
                            <stop offset="100%" stopColor="rgba(59, 130, 246, 0.3)" />
                        </linearGradient>
                    </defs>
                    <line x1="25%" y1="30%" x2="50%" y2="50%" stroke="url(#lineGradient)" strokeWidth="2" className="connection-line" />
                    <line x1="50%" y1="50%" x2="75%" y2="70%" stroke="url(#lineGradient)" strokeWidth="2" className="connection-line" />
                    <line x1="40%" y1="60%" x2="60%" y2="60%" stroke="url(#lineGradient)" strokeWidth="2" className="connection-line" />
                </svg>
            </div>

            <div className="landing-content">
                <div className="landing-logo">
                    <div className="logo-container">
                        <div className="logo-icon">
                            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="50" cy="50" r="45" stroke="url(#gradient1)" strokeWidth="2" fill="none" opacity="0.4">
                                    <animate attributeName="r" values="45;48;45" dur="4s" repeatCount="indefinite"/>
                                </circle>
                                <circle cx="50" cy="50" r="30" stroke="url(#gradient2)" strokeWidth="2" fill="none" opacity="0.5">
                                    <animate attributeName="r" values="30;33;30" dur="3s" repeatCount="indefinite"/>
                                </circle>
                                <circle cx="50" cy="50" r="18" fill="url(#gradient3)" opacity="0.9">
                                    <animate attributeName="r" values="18;20;18" dur="2.5s" repeatCount="indefinite"/>
                                </circle>
                                <path d="M 50 25 L 50 75 M 25 50 L 75 50" stroke="url(#gradient4)" strokeWidth="2" opacity="0.6">
                                    <animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="10s" repeatCount="indefinite"/>
                                </path>
                                <defs>
                                    <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#06b6d4" />
                                    </linearGradient>
                                    <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#8b5cf6" />
                                        <stop offset="100%" stopColor="#ec4899" />
                                    </linearGradient>
                                    <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#60a5fa" />
                                        <stop offset="100%" stopColor="#06b6d4" />
                                    </linearGradient>
                                    <linearGradient id="gradient4" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#8b5cf6" />
                                    </linearGradient>
                                </defs>
                            </svg>
                        </div>
                    </div>
                </div>

                <h1 className="landing-title">
                    <span className="title-main">KernelEye</span>
                    <div className="title-accent"></div>
                    <div className="title-tagline">
                        Real-time Kubernetes Observability with eBPF
                    </div>
                </h1>

                <div className="landing-description">
                    <p>Advanced monitoring and orchestration platform providing deep insights into container performance, network behavior, and system resources through kernel-level telemetry.</p>
                </div>

                <div className="landing-features">
                    <div className="feature-item">
                        <div className="feature-icon-wrapper">
                            <div className="feature-icon-circle"></div>
                        </div>
                        <div className="feature-text">Real-time Metrics</div>
                    </div>
                    <div className="feature-item">
                        <div className="feature-icon-wrapper">
                            <div className="feature-icon-circle"></div>
                        </div>
                        <div className="feature-text">Deep Observability</div>
                    </div>
                    <div className="feature-item">
                        <div className="feature-icon-wrapper">
                            <div className="feature-icon-circle"></div>
                        </div>
                        <div className="feature-text">Performance Optimization</div>
                    </div>
                </div>

                <div className="landing-loading">
                    <div className="loading-spinner"></div>
                    <div className="loading-text">Initializing System</div>
                    <div className="loading-progress">
                        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
