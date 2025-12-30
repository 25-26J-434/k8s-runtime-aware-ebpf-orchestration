import { useEffect, useMemo, useState } from 'react';
import { FiActivity, FiAlertTriangle, FiRefreshCw, FiSend, FiServer, FiZap } from 'react-icons/fi';
import { useMetrics } from '../hooks/useMetrics';
import { api } from '../services/api';
import type { RedirectionEvent, RedirectionEventPayload } from '../types/api';
import './Page.css';
import './Routing.css';

const defaultPayload: RedirectionEventPayload = {
    policy_name: 'redirect-service-a-to-c',
    frontend_service: 'service-a',
    planned_backend_service: 'service-b',
    planned_backend_label: 'app=service-b',
    planned_backend_port: '5001',
    final_backend_service: 'service-c',
    final_backend_label: 'app=service-c',
    final_backend_port: '5003',
    redirect_backend_label: 'app=service-c',
    redirect_backend_port: '5003',
    violation_triggered: true,
    accepted_service: 'service-c',
    status: 'applied',
    notes: 'Hello I am service C (redirect winner)',
};

export function Routing() {
    const { metrics } = useMetrics(6000);
    const [payload, setPayload] = useState<RedirectionEventPayload>(defaultPayload);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [lastEvent, setLastEvent] = useState<RedirectionEvent | null>(null);
    const [identity, setIdentity] = useState<string>('');
    const [identityError, setIdentityError] = useState<string | null>(null);

    const flowFrontend = payload.frontend_service || 'service-a';
    const flowPlanned = payload.planned_backend_service || 'service-b';
    const flowFinal = lastEvent?.accepted_service || payload.final_backend_service || 'service-c';
    const plannedPort = payload.planned_backend_port || '5001';
    const finalPort = payload.final_backend_port || payload.redirect_backend_port || '5003';
    const violationTriggered = lastEvent?.violation_triggered ?? payload.violation_triggered;

    // Resolve backend identity to show which node/service will receive the event
    useEffect(() => {
        const fetchIdentity = async () => {
            try {
                const text = await api.getRoutingIdentity();
                setIdentity(text.trim());
            } catch (err: any) {
                setIdentityError(err?.message || 'Unable to reach routing backend');
            }
        };

        fetchIdentity();
    }, []);

    // Optionally show the most recent recorded event for context
    useEffect(() => {
        const fetchLatest = async () => {
            try {
                const events = await api.getRedirectionEvents();
                if (events && events.length > 0) {
                    setLastEvent(events[0]);
                }
            } catch (_err) {
                // Ignore history fetch failures; the form still works
            }
        };

        fetchLatest();
    }, []);

    const updateField = (field: keyof RedirectionEventPayload, value: string | boolean) => {
        setPayload((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const resetPayload = () => {
        setPayload(defaultPayload);
        setError(null);
        setSuccess(null);
    };

    const nodeName = metrics?.node_name || 'Unknown node';
    const nodeIp = metrics?.node_ip || 'N/A';

    const previewJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

    const getPodsForService = (serviceName: string): string[] => {
        if (!metrics?.pods) return [];
        return Object.keys(metrics.pods).filter((podKey) => {
            const [, podName] = podKey.split('/');
            return podName && podName.includes(serviceName);
        });
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setSuccess(null);

        // Remove empty optional fields so the backend only stores what matters
        const sanitizedPayload = Object.entries(payload).reduce((acc, [key, value]) => {
            if (value === undefined || value === null) return acc;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed === '') return acc;
                acc[key as keyof RedirectionEventPayload] = trimmed as any;
            } else {
                acc[key as keyof RedirectionEventPayload] = value as any;
            }
            return acc;
        }, {} as RedirectionEventPayload);

        try {
            const created = await api.createRedirectionEvent(sanitizedPayload);
            setLastEvent(created);
            setSuccess('Redirection event recorded in Component 2 backend.');
        } catch (err: any) {
            setError(err?.message || 'Failed to create redirection event');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="page-container routing-page">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Intelligent Traffic Routing</h1>
                    <p className="page-subtitle">
                        Send routing decisions from the UI to the Component 2 backend. Monitor which node is active and push the same payload you use in Postman.
                    </p>
                </div>
            </div>

            <div className="routing-grid">
                <div className="routing-card routing-status">
                    <div className="card-title">
                        <FiServer />
                        <span>Current Node</span>
                    </div>
                    <div className="status-grid">
                        <div className="status-item">
                            <div className="status-label">Node</div>
                            <div className="status-value">{nodeName}</div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Node IP</div>
                            <div className="status-value">{nodeIp}</div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Backend</div>
                            <div className="status-value">
                                {identity ? identity : identityError || 'Resolving...'}
                            </div>
                        </div>
                    </div>
                    <div className="status-hint">
                        <FiActivity /> The UI talks to http://localhost:4000 for routing events. Keep the backend running and MongoDB available.
                    </div>
                </div>

                <div className="routing-card info">
                    <div className="card-title">
                        <FiAlertTriangle />
                        <span>What this form does</span>
                    </div>
                    <p className="info-copy">
                        This is a UI wrapper for the Postman/terminal call:
                        <code className="inline-code">POST http://localhost:4000/api/redirections</code>. Submit the payload below to record
                        a redirection event, exactly like the sample you used in the backend.
                    </p>
                    <div className="curl-block">
                        curl -X POST http://localhost:4000/api/redirections \
                        <br />
                        &nbsp;&nbsp;--header &apos;Content-Type: application/json&apos; \
                        <br />
                        &nbsp;&nbsp;--data @payload.json
                    </div>
                </div>
            </div>

            <div className="routing-card form-card">
                <div className="form-header">
                    <div>
                        <div className="card-title">
                            <FiSend />
                            <span>Send Redirection Event</span>
                        </div>
                        <p className="info-copy">Fill in the routing decision fields and push them to the backend.</p>
                    </div>
                    <div className="header-actions">
                        <button type="button" className="ghost-button" onClick={resetPayload} disabled={submitting}>
                            <FiRefreshCw /> Reset to sample
                        </button>
                        <button type="submit" form="routing-form" className="primary-button" disabled={submitting}>
                            {submitting ? 'Submitting...' : 'Submit event'}
                        </button>
                    </div>
                </div>

                <form id="routing-form" className="routing-form" onSubmit={handleSubmit}>
                    <div className="form-grid">
                        <label className="form-field">
                            <span className="form-label">Policy Name *</span>
                            <input
                                type="text"
                                value={payload.policy_name}
                                onChange={(e) => updateField('policy_name', e.target.value)}
                                required
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Frontend Service</span>
                            <input
                                type="text"
                                value={payload.frontend_service || ''}
                                onChange={(e) => updateField('frontend_service', e.target.value)}
                                placeholder="service-a"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Planned Backend Service</span>
                            <input
                                type="text"
                                value={payload.planned_backend_service || ''}
                                onChange={(e) => updateField('planned_backend_service', e.target.value)}
                                placeholder="service-b"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Planned Backend Label</span>
                            <input
                                type="text"
                                value={payload.planned_backend_label || ''}
                                onChange={(e) => updateField('planned_backend_label', e.target.value)}
                                placeholder="app=service-b"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Planned Backend Port</span>
                            <input
                                type="text"
                                value={payload.planned_backend_port || ''}
                                onChange={(e) => updateField('planned_backend_port', e.target.value)}
                                placeholder="5001"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Final Backend Service</span>
                            <input
                                type="text"
                                value={payload.final_backend_service || ''}
                                onChange={(e) => updateField('final_backend_service', e.target.value)}
                                placeholder="service-c"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Final Backend Label</span>
                            <input
                                type="text"
                                value={payload.final_backend_label || ''}
                                onChange={(e) => updateField('final_backend_label', e.target.value)}
                                placeholder="app=service-c"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Final Backend Port</span>
                            <input
                                type="text"
                                value={payload.final_backend_port || ''}
                                onChange={(e) => updateField('final_backend_port', e.target.value)}
                                placeholder="5003"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Backend Label</span>
                            <input
                                type="text"
                                value={payload.redirect_backend_label || ''}
                                onChange={(e) => updateField('redirect_backend_label', e.target.value)}
                                placeholder="app=service-c"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Backend Port</span>
                            <input
                                type="text"
                                value={payload.redirect_backend_port || ''}
                                onChange={(e) => updateField('redirect_backend_port', e.target.value)}
                                placeholder="5003"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Accepted Service</span>
                            <input
                                type="text"
                                value={payload.accepted_service || ''}
                                onChange={(e) => updateField('accepted_service', e.target.value)}
                                placeholder="service-c"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Status</span>
                            <select
                                value={payload.status || 'applied'}
                                onChange={(e) => updateField('status', e.target.value)}
                            >
                                <option value="applied">applied</option>
                                <option value="expired">expired</option>
                                <option value="deleted">deleted</option>
                                <option value="skipped">skipped</option>
                                <option value="observed">observed</option>
                            </select>
                        </label>
                        <label className="form-field toggle-field">
                            <span className="form-label">Violation Triggered</span>
                            <div className="toggle-wrapper">
                                <input
                                    type="checkbox"
                                    checked={payload.violation_triggered}
                                    onChange={(e) => updateField('violation_triggered', e.target.checked)}
                                />
                                <span>{payload.violation_triggered ? 'Yes' : 'No'}</span>
                            </div>
                        </label>
                    </div>

                    <label className="form-field">
                        <span className="form-label">Notes</span>
                        <textarea
                            rows={3}
                            value={payload.notes || ''}
                            onChange={(e) => updateField('notes', e.target.value)}
                            placeholder="Add operator notes or context for this redirect."
                        />
                    </label>

                    {error && (
                        <div className="alert error">
                            <FiAlertTriangle /> {error}
                        </div>
                    )}
                    {success && (
                        <div className="alert success">
                            <FiActivity /> {success}
                        </div>
                    )}
                </form>
            </div>

            <div className="routing-card pod-flow-card">
                <div className="card-title">
                    <FiZap />
                    <span>Packet Path</span>
                </div>
                <p className="info-copy">
                    Visual cue of the planned path (A → B) and the redirect path (A → C). The planned arrow turns red when a violation is detected; the green arrow lights up to show the new route.
                </p>
                <div className="packet-tracer">
                    <svg className="packet-canvas" viewBox="0 0 720 240" preserveAspectRatio="xMidYMid meet">
                        <defs>
                            <marker id="arrowHeadPlanned" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                                <polygon points="0 0, 12 6, 0 12" fill="url(#plannedGrad)" />
                            </marker>
                            <marker id="arrowHeadRedirect" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                                <polygon points="0 0, 12 6, 0 12" fill="url(#redirectGrad)" />
                            </marker>
                            <linearGradient id="plannedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.9" />
                            </linearGradient>
                            <linearGradient id="redirectGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.95" />
                            </linearGradient>
                        </defs>

                        {/* Planned path A -> B */}
                        <line
                            x1="154"
                            y1="120"
                            x2="316"
                            y2="120"
                            className={`planned-path ${violationTriggered ? 'alert' : ''}`}
                            markerEnd="url(#arrowHeadPlanned)"
                        />

                        {/* Redirect path A -> C */}
                        <line
                            x1="154"
                            y1="120"
                            x2="566"
                            y2="120"
                            className={`redirect-path ${violationTriggered ? 'active' : ''}`}
                            markerEnd="url(#arrowHeadRedirect)"
                        />

                        {/* Nodes */}
                        <g className="node frontend" transform="translate(120,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">A</text>
                        </g>
                        <text className="node-label-svg" x="120" y="170">{flowFrontend}</text>

                        <g className={`node planned ${violationTriggered ? 'muted' : ''}`} transform="translate(350,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">B</text>
                        </g>
                        <text className="node-label-svg" x="350" y="170">{flowPlanned}</text>

                        <g className="node final" transform="translate(580,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">C</text>
                        </g>
                        <text className="node-label-svg" x="580" y="170">{flowFinal}</text>

                        {/* Packets */}
                        <g className="packet planned">
                            <circle cx="154" cy="120" r="7" />
                        </g>
                        <g className={`packet redirect ${violationTriggered ? 'active' : ''}`}>
                            <circle cx="154" cy="120" r="7" />
                        </g>
                    </svg>

                    {/* Absolute positioned packet dots to make the motion obvious */}
                    <div className="packet-dot planned"></div>
                    <div className={`packet-dot redirect ${violationTriggered ? 'active' : ''}`}></div>

                    <div className="packet-tracer-legend">
                        <div className="legend-item">
                            <span className="legend-chip planned" /> Planned :{plannedPort}
                        </div>
                        <div className="legend-item">
                            <span className="legend-chip redirect" /> Redirect :{finalPort} {violationTriggered ? '(active)' : '(armed)'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="routing-grid">
                <div className="routing-card">
                    <div className="card-title">
                        <FiSend />
                        <span>Payload Preview</span>
                    </div>
                    <p className="info-copy">Exact JSON that will be posted to the backend.</p>
                    <pre className="payload-preview">{previewJson}</pre>
                </div>

                {lastEvent && (
                    <div className="routing-card">
                        <div className="card-title">
                            <FiActivity />
                            <span>Last Recorded Event</span>
                        </div>
                        <div className="event-details">
                            <div className="event-row">
                                <span className="label">Policy</span>
                                <span className="value">{lastEvent.policy_name}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Status</span>
                                <span className="value badge">{lastEvent.status || 'applied'}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Accepted Service</span>
                                <span className="value">{lastEvent.accepted_service || '—'}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Recorded At</span>
                                <span className="value">
                                    {lastEvent.occurred_at ? new Date(lastEvent.occurred_at).toLocaleString() : 'unknown'}
                                </span>
                            </div>
                            {lastEvent.notes && (
                                <div className="event-row">
                                    <span className="label">Notes</span>
                                    <span className="value">{lastEvent.notes}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
