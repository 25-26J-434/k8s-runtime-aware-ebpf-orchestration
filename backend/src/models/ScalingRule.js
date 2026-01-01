const mongoose = require('mongoose');

const ScalingRuleSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    namespace: { type: String, required: true },
    deployment: { type: String, required: true },
    metric: { type: String, required: true, enum: ['dns_latency', 'rtt', 'tcp_retrans'] },
    operator: { type: String, required: true, enum: ['>', '<'], default: '>' },
    threshold: { type: Number, required: true, default: 0 },
    minReplicas: { type: Number, required: true, default: 1 },
    maxReplicas: { type: Number, required: true, default: 3 },
    step: { type: Number, required: true, default: 1 },
    lastAction: { type: String },
    lastActionAt: { type: Date },
    lastValue: { type: Number },
    lastFrom: { type: Number },
    lastTo: { type: Number },
  },
  {
    timestamps: true,
    collection: 'scaling_rules',
  }
);

module.exports = mongoose.model('ScalingRule', ScalingRuleSchema);
