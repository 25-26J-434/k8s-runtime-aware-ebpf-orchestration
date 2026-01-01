const { Schema, model } = require('mongoose');

const RuleSchema = new Schema(
  {
    policy_name: { type: String, required: true, unique: true },
    metric: { type: String, default: 'rtt_us' },
    violation_threshold: { type: Number, required: true },
    notes: { type: String },
  },
  { timestamps: true, versionKey: false }
);

RuleSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = model('Rule', RuleSchema);
