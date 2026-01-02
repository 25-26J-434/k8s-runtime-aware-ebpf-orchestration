const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
require('dotenv').config();

const ScalingRule = require('./models/ScalingRule');

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

const PORT = process.env.SCALING_PORT || 3001;
const MONGODB_URI = process.env.SCALING_MONGODB_URI || 'mongodb://localhost:27017/rulesdb';

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log(`[scaling-backend] Connected to MongoDB at ${MONGODB_URI}`))
  .catch((err) => {
    console.error('[scaling-backend] MongoDB connection failed', err);
    process.exit(1);
  });

function normalizeRule(body) {
  const data = {};
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
  if (body.namespace !== undefined) data.namespace = String(body.namespace);
  if (body.deployment !== undefined) data.deployment = String(body.deployment);
  if (body.metric !== undefined) data.metric = String(body.metric);
  if (body.operator !== undefined) data.operator = String(body.operator);
  if (body.threshold !== undefined) data.threshold = Number(body.threshold);
  if (body.minReplicas !== undefined) data.minReplicas = Number(body.minReplicas);
  if (body.maxReplicas !== undefined) data.maxReplicas = Number(body.maxReplicas);
  if (body.step !== undefined) data.step = Number(body.step);
  return data;
}

function validateRule(data) {
  const required = ['namespace', 'deployment', 'metric', 'operator', 'threshold', 'minReplicas', 'maxReplicas', 'step'];
  const missing = required.filter((key) => data[key] === undefined || data[key] === '');
  if (missing.length) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  if (!['dns_latency', 'rtt', 'tcp_retrans'].includes(data.metric)) {
    return 'metric must be one of dns_latency, rtt, tcp_retrans';
  }
  if (!['>', '<'].includes(data.operator)) {
    return 'operator must be > or <';
  }
  if (![data.threshold, data.minReplicas, data.maxReplicas, data.step].every(Number.isFinite)) {
    return 'threshold, minReplicas, maxReplicas, step must be numbers';
  }
  if (data.minReplicas < 0 || data.maxReplicas < 0 || data.step < 1) {
    return 'minReplicas/maxReplicas must be >= 0 and step must be >= 1';
  }
  if (data.minReplicas > data.maxReplicas) {
    return 'minReplicas must be <= maxReplicas';
  }
  return null;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/scaling-rules', async (_req, res, next) => {
  try {
    const rules = await ScalingRule.find().sort({ updatedAt: -1 });
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

app.post('/api/scaling-rules', async (req, res, next) => {
  try {
    const data = normalizeRule(req.body || {});
    if (data.enabled === undefined) data.enabled = true;
    const error = validateRule(data);
    if (error) return res.status(400).json({ error });
    const created = await ScalingRule.create(data);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.put('/api/scaling-rules/:id', async (req, res, next) => {
  try {
    const data = normalizeRule(req.body || {});
    if (data.enabled === undefined) {
      return res.status(400).json({ error: 'enabled is required' });
    }
    const updated = await ScalingRule.findByIdAndUpdate(
      req.params.id,
      { $set: { enabled: Boolean(data.enabled) } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'rule not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/scaling-rules/:id', async (req, res, next) => {
  try {
    const deleted = await ScalingRule.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'rule not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('[scaling-backend] error', err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, () => {
  console.log(`[scaling-backend] Listening on :${PORT}`);
});
