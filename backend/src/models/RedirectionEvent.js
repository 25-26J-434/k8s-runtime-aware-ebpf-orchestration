const { Schema, model } = require('mongoose');

const RedirectionEventSchema = new Schema(
  {
    policy_name: { type: String, required: true, index: true },
    frontend_service: { type: String },
    redirect_backend_label: { type: String },
    redirect_backend_port: { type: String },
    violation_triggered: { type: Boolean, required: true },
    accepted_service: { type: String },
    status: {
      type: String,
      enum: ['applied', 'expired', 'deleted', 'skipped', 'observed'],
      default: 'applied',
    },
    notes: { type: String },
    occurred_at: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

RedirectionEventSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = model('RedirectionEvent', RedirectionEventSchema);
