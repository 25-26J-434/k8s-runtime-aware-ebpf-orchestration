import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';

export function Landing() {
    const navigate = useNavigate();
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const totalDuration = 10000;
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
                <div className="landing-particles">
                    {Array.from({ length: 80 }).map((_, i) => (
                        <div key={i} className="particle" style={{
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 5}s`,
                            animationDuration: `${4 + Math.random() * 6}s`
                        }}></div>
                    ))}
                </div>
                <div className="landing-orb orb-1"></div>
                <div className="landing-orb orb-2"></div>
                <div className="landing-orb orb-3"></div>
                <div className="landing-rings">
                    <div className="ring ring-1"></div>
                    <div className="ring ring-2"></div>
                    <div className="ring ring-3"></div>
                </div>
                
                {/* Kubernetes Cluster Visualization */}
                <div className="k8s-cluster">
                    <div className="k8s-node node-1">
                        <div className="node-core"></div>
                        <div className="node-pods">
                            <div className="pod pod-1"></div>
                            <div className="pod pod-2"></div>
                            <div className="pod pod-3"></div>
                        </div>
                    </div>
                    <div className="k8s-node node-2">
                        <div className="node-core"></div>
                        <div className="node-pods">
                            <div className="pod pod-4"></div>
                            <div className="pod pod-5"></div>
                        </div>
                    </div>
                    <div className="k8s-node node-3">
                        <div className="node-core"></div>
                        <div className="node-pods">
                            <div className="pod pod-6"></div>
                            <div className="pod pod-7"></div>
                            <div className="pod pod-8"></div>
                        </div>
                    </div>
                    <div className="k8s-connections">
                        <svg className="connection-svg">
                            <defs>
                                <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
                                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
                                </linearGradient>
                            </defs>
                            <line className="connection-line line-1" x1="20%" y1="30%" x2="50%" y2="50%" />
                            <line className="connection-line line-2" x1="50%" y1="50%" x2="80%" y2="70%" />
                            <line className="connection-line line-3" x1="20%" y1="30%" x2="80%" y2="70%" />
                        </svg>
                    </div>
                </div>

                {/* eBPF Data Streams */}
                <div className="ebpf-streams">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="data-stream" style={{
                            left: `${10 + (i * 7)}%`,
                            animationDelay: `${i * 0.3}s`,
                            animationDuration: `${3 + Math.random() * 2}s`
                        }}></div>
                    ))}
                </div>
            </div>

            <div className="landing-content">
                <div className="landing-logo">
                    <div className="logo-container">
                        <div className="logo-hex"></div>
                        <div className="logo-icon">
                            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="50" cy="50" r="45" stroke="url(#gradient1)" strokeWidth="3" fill="none" opacity="0.3">
                                    <animate attributeName="r" values="45;50;45" dur="3s" repeatCount="indefinite"/>
                                    <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite"/>
                                </circle>
                                <circle cx="50" cy="50" r="35" stroke="url(#gradient2)" strokeWidth="2" fill="none" opacity="0.5">
                                    <animate attributeName="r" values="35;40;35" dur="2.5s" repeatCount="indefinite"/>
                                    <animate attributeName="opacity" values="0.5;0.8;0.5" dur="2.5s" repeatCount="indefinite"/>
                                </circle>
                                <circle cx="50" cy="50" r="20" fill="url(#gradient3)" opacity="0.8">
                                    <animate attributeName="r" values="20;25;20" dur="2s" repeatCount="indefinite"/>
                                    <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite"/>
                                </circle>
                                <path d="M 50 20 L 50 80 M 20 50 L 80 50" stroke="url(#gradient4)" strokeWidth="2" opacity="0.6">
                                    <animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="8s" repeatCount="indefinite"/>
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
                    <span className="title-main">
                        <span className="letter" style={{ animationDelay: '0s' }}>K</span>
                        <span className="letter" style={{ animationDelay: '0.1s' }}>e</span>
                        <span className="letter" style={{ animationDelay: '0.2s' }}>r</span>
                        <span className="letter" style={{ animationDelay: '0.3s' }}>n</span>
                        <span className="letter" style={{ animationDelay: '0.4s' }}>e</span>
                        <span className="letter" style={{ animationDelay: '0.5s' }}>l</span>
                        <span className="letter" style={{ animationDelay: '0.7s' }}>E</span>
                        <span className="letter" style={{ animationDelay: '0.8s' }}>y</span>
                        <span className="letter" style={{ animationDelay: '0.9s' }}>e</span>
                    </span>
                    <div className="title-accent"></div>
                </h1>

                <div className="landing-loading">
                    <div className="loading-spinner"></div>
                    <div className="loading-progress">
                        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

