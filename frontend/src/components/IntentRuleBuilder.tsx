import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import './IntentRuleBuilder.css';

type MetricKey = 'dns_latency_us' | 'tcp_handshake_us' | 'retransmits';

const metricLabels: Record<MetricKey, string> = {
    dns_latency_us: 'DNS latency (µs)',
    tcp_handshake_us: 'TCP handshake (µs)',
    retransmits: 'Packet retransmissions',
};

const TARGET_NAMESPACE = 'test-services';

export function IntentRuleBuilder() {
    const [intentName, setIntentName] = useState('low-latency');
    const [metric, setMetric] = useState<MetricKey>('dns_latency_us');
    const [threshold, setThreshold] = useState(100);
    const [action, setAction] = useState('reroute');
    const [service, setService] = useState('service-b');
    const [fallbackService, setFallbackService] = useState('service-b');
    const [nodeScope, setNodeScope] = useState('ebpf-cluster-control-plane');
    const [beforeLatency] = useState(80);
    const [afterLatency] = useState(180);
    const [toast, setToast] = useState<string | null>(null);

    const [serviceOptions, setServiceOptions] = useState<string[]>(['service-a', 'service-b', 'service-b-alt']);
    const [nodeOptions, setNodeOptions] = useState<string[]>(['ebpf-cluster-control-plane', 'ebpf-cluster-worker']);

    useEffect(() => {
        let ignore = false;
        async function loadOptions() {
            try {
                const [metrics, topology, services] = await Promise.all([
                    api.getMetrics().catch(() => null),
                    api.getClusterTopology().catch(() => null),
                    api.getServices().catch(() => []),
                ]);

                if (ignore) return;

                const svcSet = new Set<string>(['service-a', 'service-b', 'service-b-alt']);
                services.forEach(s => svcSet.add(s.name));
                setServiceOptions(Array.from(svcSet));
                if (!svcSet.has(service)) {
                    const first = Array.from(svcSet)[0];
                    setService(first);
                    setFallbackService(first);
                }

                if (topology?.nodes?.length) {
                    const nodes = topology.nodes.map(n => n.name);
                    setNodeOptions(nodes);
                    if (!nodes.includes(nodeScope)) {
                        setNodeScope(nodes[0]);
                    }
                }
            } catch (e) {
                // Ignore errors; keep defaults
            }
        }

        loadOptions();
        return () => { ignore = true; };
    }, [service, nodeScope]);

    const policy = useMemo(() => ({
        intent: intentName,
        metric,
        threshold,
        action,
        namespace: TARGET_NAMESPACE,
        service,
        fallback: fallbackService,
        node: nodeScope,
    }), [intentName, metric, threshold, action, service, fallbackService, nodeScope]);

    const beforeViolation = beforeLatency > threshold;
    const afterViolation = afterLatency > threshold;
    const afterBackend = afterViolation ? fallbackService : service;
    const sameBackend = service === fallbackService;
    const decisionBefore = `${metricLabels[metric]} = ${beforeLatency} → ${beforeViolation ? 'above' : 'within'} ${threshold} → ${beforeViolation ? action.toUpperCase() : 'no action'}`;
    const decisionAfter = `${metricLabels[metric]} = ${afterLatency} → ${afterViolation ? 'above' : 'within'} ${threshold} → ${afterViolation ? action.toUpperCase() : 'no action'} ${afterViolation ? `to ${fallbackService}` : ''}`;

    const handleApply = () => {
        setToast('Rule staged locally (ready for API hookup)');
        console.log('Staged rule:', policy);
        setTimeout(() => setToast(null), 3000);
    };

    return (
        <div className="intent-builder">
            {toast && <div className="intent-toast">{toast}</div>}
            <div className="intent-grid">
                <div className="intent-field">
                    <label>Intent name</label>
                    <input value={intentName} onChange={(e) => setIntentName(e.target.value)} className="intent-input" />
                </div>

                <div className="intent-field">
                    <label>Metric</label>
                    <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="intent-select">
                        {Object.entries(metricLabels).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>

                <div className="intent-field">
                    <label>Threshold</label>
                    <input
                        type="number"
                        min={0}
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        className="intent-input"
                    />
                </div>

                <div className="intent-field">
                    <label>Action</label>
                    <select value={action} onChange={(e) => setAction(e.target.value)} className="intent-select">
                        <option value="reroute">Reroute</option>
                        <option value="alert">Alert only</option>
                    </select>
                </div>

                <div className="intent-field">
                    <label>Primary service</label>
                    <select value={service} onChange={(e) => setService(e.target.value)} className="intent-select">
                        {serviceOptions.map(svc => (
                            <option key={svc} value={svc}>{svc}</option>
                        ))}
                    </select>
                </div>

                <div className="intent-field">
                    <label>Fallback service</label>
                    <select value={fallbackService} onChange={(e) => setFallbackService(e.target.value)} className="intent-select">
                        {serviceOptions.map(svc => (
                            <option key={svc} value={svc}>{svc}</option>
                        ))}
                    </select>
                </div>

                <div className="intent-field">
                    <label>Node scope</label>
                    <select value={nodeScope} onChange={(e) => setNodeScope(e.target.value)} className="intent-select">
                        {nodeOptions.map(node => (
                            <option key={node} value={node}>{node}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="intent-actions">
                <button className="intent-apply" onClick={handleApply}>Apply Rule (stub)</button>
                <div className="intent-hint">Future: send to backend endpoint (e.g., POST /api/routing/rules)</div>
            </div>

            <div className="intent-panels">
                <div className="intent-panel">
                    <div className="intent-panel-header">
                        <span className="intent-dot before" />
                        <div>
                            <div className="intent-panel-title">Telemetry — Before</div>
                            <div className="intent-panel-subtitle">Healthy baseline</div>
                        </div>
                    </div>
                    <ul className="intent-list">
                        <li>{metricLabels[metric]}: {beforeLatency}</li>
                        <li>TCP handshake: 80 ms (sample)</li>
                        <li>Retransmits: 0</li>
                        <li>Active backend: {service}</li>
                    </ul>
                    <div className={`intent-decision ${beforeViolation ? 'alert' : 'ok'}`}>
                        Decision: {beforeViolation ? `${action.toUpperCase()} (would trigger)` : 'Within threshold → no action'}
                    </div>
                    <div className="intent-detail">{decisionBefore}</div>
                    <div className="intent-route same">Primary route: {service}</div>
                </div>

                <div className="intent-panel">
                    <div className="intent-panel-header">
                        <span className="intent-dot after" />
                        <div>
                            <div className="intent-panel-title">Telemetry — After</div>
                            <div className="intent-panel-subtitle">Violation detected</div>
                        </div>
                    </div>
                    <ul className="intent-list">
                        <li>{metricLabels[metric]}: {afterLatency}</li>
                        <li>TCP handshake: 180 ms (sample)</li>
                        <li>Retransmits: 7</li>
                        <li>Active backend: {afterBackend}</li>
                    </ul>
                    <div className={`intent-decision ${afterViolation ? 'alert' : 'ok'}`}>
                        Decision: {afterViolation ? `Threshold violated → ${action.toUpperCase()}` : 'Within threshold → no action'}
                    </div>
                    <div className="intent-detail">{decisionAfter}</div>
                    <div className={`intent-route ${afterViolation ? 'change' : 'same'}`}>
                        {afterViolation
                            ? `Reroute: ${service} → ${fallbackService}${sameBackend ? ' (fallback = primary)' : ''}`
                            : `Route unchanged: ${service}`}
                    </div>
                </div>

                <div className="intent-panel">
                    <div className="intent-panel-header">
                        <span className="intent-dot policy" />
                        <div>
                            <div className="intent-panel-title">Intent Policy</div>
                            <div className="intent-panel-subtitle">Rendered JSON for audit/export</div>
                        </div>
                    </div>
                    <pre className="intent-json">
{JSON.stringify(policy, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
}
