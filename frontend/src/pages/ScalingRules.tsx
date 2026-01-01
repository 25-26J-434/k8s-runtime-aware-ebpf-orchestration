import './Page.css';
import { useState } from 'react';
import { ScalingRulesTable } from '../components/ScalingRulesTable';
import { ScalingRuleForm } from '../components/ScalingRuleForm';
import { useScalingRules } from '../hooks/useScalingRules';
import type { ScalingRule } from '../types/scaling';

export function ScalingRules() {
    const { rules, deployments, latestMetrics, loading, error, createRule, toggleRule, deleteRule } = useScalingRules();
    const [showForm, setShowForm] = useState(false);

    const handleCreate = async (rule: Partial<ScalingRule>) => {
        await createRule(rule);
        setShowForm(false);
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Scaling Rules Management</h1>
                    <p className="page-subtitle">Manage autoscaling rules driven by eBPF telemetry</p>
                </div>
            </div>

            <div className="page-content">
                <div className="feature-card">
                    <div className="scaling-toolbar">
                        <div style={{ flex: 1 }}>
                            <strong>Rules</strong>
                            <div className="list-subtext">Create and manage autoscaling rules. Frontend communicates with backend only.</div>
                        </div>
                        <div>
                            <button className="btn btn-primary" onClick={() => { setShowForm(true); }}>Create Rule</button>
                        </div>
                    </div>

                    {loading && <div>Loading rules...</div>}
                    {error && <div className="error">{error}</div>}

                    {rules && rules.length === 0 && <div className="list-subtext">No scaling rules found.</div>}

                    {rules && rules.length > 0 && (
                        <ScalingRulesTable
                            rules={rules}
                            deployments={deployments}
                            latestMetrics={latestMetrics}
                            onToggle={async (id, enabled) => { try { await toggleRule(id, enabled); } catch (err) { console.error(err); } }}
                            onDelete={async (id) => { try { await deleteRule(id); } catch (err) { console.error(err); } }}
                        />
                    )}

                </div>
            </div>

            {showForm && (
                <div className="modal">
                    <div className="modal-card">
                        <h2>Create Rule</h2>
                        <ScalingRuleForm
                            onCancel={() => { setShowForm(false); }}
                            onSubmit={handleCreate}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
