const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
require('dotenv').config();

const RedirectRule = require('./models/RedirectRule');

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebpf-routing';

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log(`[component2-backend] Connected to MongoDB at ${MONGODB_URI}`))
  .catch((err) => {
    console.error('[component2-backend] MongoDB connection failed', err);
    process.exit(1);
  });

const REQUIRED_FIELDS = [
  'policy_name',
  'namespace',
  'frontend_service',
  'frontend_service_port',
  'monitor_pod_contains',
  'metric',
  'violation_threshold',
  'action',
  'redirect_backend_label',
  'redirect_backend_port',
  'redirect_backend_protocol',
  'ttl_seconds',
];

const NUMERIC_FIELDS = ['violation_threshold', 'ttl_seconds', 'redirect_backend_port', 'frontend_service_port'];
const BOOLEAN_FIELDS = ['choose_best_pod'];

function normalizeRule(body, { requireAll } = { requireAll: true }) {
  const data = {};
  for (const key of REQUIRED_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.backend_candidate_label !== undefined) data.backend_candidate_label = body.backend_candidate_label;
  if (body.redirect_winner_label !== undefined) data.redirect_winner_label = body.redirect_winner_label;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.choose_best_pod !== undefined) data.choose_best_pod = body.choose_best_pod;

  for (const field of NUMERIC_FIELDS) {
    if (data[field] !== undefined) {
      const num = Number(data[field]);
      if (!Number.isFinite(num)) {
        return { error: `${field} must be a number` };
      }
      data[field] = num;
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (data[field] !== undefined) {
      data[field] = Boolean(data[field]);
    }
  }

  if (data.ttl_seconds !== undefined && data.ttl_seconds <= 0) {
    return { error: 'ttl_seconds must be greater than zero' };
  }

  const missing = requireAll ? REQUIRED_FIELDS.filter((f) => data[f] === undefined) : [];
  if (missing.length) {
    return { error: `Missing required fields: ${missing.join(', ')}` };
  }

  data.metric = data.metric || 'rtt_us';
  data.action = data.action || 'redirect';
  data.redirect_backend_protocol = data.redirect_backend_protocol || 'TCP';
  data.backend_candidate_label = data.backend_candidate_label || data.redirect_backend_label;
  data.redirect_winner_label = data.redirect_winner_label || 'redirect-winner=yes';
  data.choose_best_pod = data.choose_best_pod ?? false;

  return { data };
}

function toRuleFile(doc) {
  return {
    policy_name: doc.policy_name,
    namespace: doc.namespace,
    frontend_service: doc.frontend_service,
    frontend_service_port: String(doc.frontend_service_port),
    monitor_pod_contains: doc.monitor_pod_contains,
    metric: doc.metric,
    violation_threshold: doc.violation_threshold,
    action: doc.action,
    redirect_backend_label: doc.redirect_backend_label,
    redirect_backend_port: String(doc.redirect_backend_port),
    redirect_backend_protocol: doc.redirect_backend_protocol,
    ttl_seconds: doc.ttl_seconds,
    choose_best_pod: doc.choose_best_pod,
    backend_candidate_label: doc.backend_candidate_label,
    redirect_winner_label: doc.redirect_winner_label,
    notes: doc.notes,
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/rules', async (_req, res, next) => {
  try {
    const rules = await RedirectRule.find().sort({ updatedAt: -1 });
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/:id', async (req, res, next) => {
  try {
    const rule = await RedirectRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/by-policy/:policyName', async (req, res, next) => {
  try {
    const rule = await RedirectRule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/:id/rule-file', async (req, res, next) => {
  try {
    const rule = await RedirectRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(toRuleFile(rule));
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/by-policy/:policyName/rule-file', async (req, res, next) => {
  try {
    const rule = await RedirectRule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(toRuleFile(rule));
  } catch (err) {
    next(err);
  }
});

app.post('/api/rules', async (req, res, next) => {
  try {
    const { data, error } = normalizeRule(req.body, { requireAll: true });
    if (error) return res.status(400).json({ message: error });

    const rule = await RedirectRule.findOneAndUpdate(
      { policy_name: data.policy_name },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

app.put('/api/rules/:id', async (req, res, next) => {
  try {
    const { data, error } = normalizeRule(req.body, { requireAll: false });
    if (error) return res.status(400).json({ message: error });
    if (!Object.keys(data).length) return res.status(400).json({ message: 'No fields provided to update' });

    const rule = await RedirectRule.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/rules/:id', async (req, res, next) => {
  try {
    const result = await RedirectRule.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message: 'Rule not found' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// Basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[component2-backend] Listening on port ${PORT}`);
});
