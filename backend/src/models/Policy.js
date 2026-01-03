const mongoose = require('mongoose');

const HistoryEventSchema = new mongoose.Schema(
    {
        ts: { type: Date, default: Date.now },
        event: { type: String, required: true }, // CREATED | UPDATED | EVALUATED | APPLIED | EXPIRED | DELETED | ERROR | SKIPPED
        message: { type: String },
        data: { type: mongoose.Schema.Types.Mixed },
    },
    { _id: false }
);

const PolicySchema = new mongoose.Schema(
    {
        policy_name: { type: String, required: true, unique: true, index: true },
        namespace: { type: String, required: true },

        // LRP frontend (service we intercept)
        frontend: {
            service: { type: String, required: true },
            port: { type: Number, required: true },
        },

        // Telemetry evaluation config
        telemetry: {
            metric: {
                type: String,
                enum: ['rtt_us', 'dns_us', 'sched_latency_us'],
                default: 'rtt_us',
            },
            violation_threshold: { type: Number, required: true },
            monitor_pod_contains: { type: String }, // default to frontend.service if missing
        },

        // Action config
        action: {
            type: { type: String, enum: ['redirect', 'none'], default: 'redirect' },

            // Backend selection (LRP backend selector)
            backend_selector: { type: String, required: true }, // e.g. "app=service-c"
            backend_port: { type: Number, required: true },
            protocol: { type: String, enum: ['TCP', 'UDP'], default: 'TCP' },

            ttl_seconds: { type: Number, required: true },

            // Research extension: choose best pod
            strategy: { type: String, enum: ['all', 'best_pod'], default: 'all' },
            backend_candidates_selector: { type: String }, // if best_pod, candidates
            winner_label: { type: String, default: 'redirect-winner=yes' }, // used only in best_pod
        },

        // Current status (derived)
        status: {
            last_evaluated_at: { type: Date },
            last_avg_value: { type: Number },
            last_violation: { type: Boolean },
            last_decision: { type: String }, // APPLIED | SKIPPED | ERROR | EXPIRED
            last_applied_at: { type: Date },
            last_expired_at: { type: Date },
            last_error: { type: String },
            last_helper_stdout: { type: String },
            last_helper_stderr: { type: String },
            last_lrp_name: { type: String }, // slug used
        },

        // Small history log (same collection)
        history: { type: [HistoryEventSchema], default: [] },
    },
    { timestamps: true }
);

PolicySchema.index({ policy_name: 1 });

module.exports = mongoose.model('Policy', PolicySchema);
