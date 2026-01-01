const { Schema, model } = require('mongoose');

const PolicySchema = new Schema(
  {
    policy_name: { type: String, required: true, unique: true },
    namespace: { type: String, required: true },
    frontend_service: { type: String, required: true },
    frontend_service_port: { type: String, required: true },
    monitor_pod_contains: { type: String, required: true },
    action: { type: String, default: 'redirect' },
    redirect_backend_label: { type: String, required: true },
    redirect_backend_port: { type: String, required: true },
    redirect_backend_protocol: { type: String, default: 'TCP' },
    ttl_seconds: { type: Number, required: true },
    strategy: { type: String, default: 'all' },
    choose_best_pod: { type: Boolean, default: false },
    backend_candidate_label: { type: String },
    redirect_winner_label: { type: String, default: 'redirect-winner=yes' },
    notes: { type: String },
  },
  { timestamps: true, versionKey: false }
);

PolicySchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = model('Policy', PolicySchema);
