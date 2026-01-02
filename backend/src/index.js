const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const os = require('os');
const path = require('path');
const util = require('util');
require('dotenv').config();

const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const Policy = require('./models/Policy');
const Rule = require('./models/Rule');
const RedirectionEvent = require('./models/RedirectionEvent');
const http = require('http');

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

const REQUIRED_POLICY_FIELDS = [
  'policy_name',
  'namespace',
  'frontend_service',
  'frontend_service_port',
  'monitor_pod_contains',
  'action',
  'redirect_backend_label',
  'redirect_backend_port',
  'redirect_backend_protocol',
  'ttl_seconds',
];

const POLICY_NUMERIC_FIELDS = ['ttl_seconds', 'redirect_backend_port', 'frontend_service_port'];
const BOOLEAN_FIELDS = ['choose_best_pod'];
const STRATEGY_VALUES = ['all', 'best_pod'];
const execFileAsync = util.promisify(execFile);
const APPLY_SCRIPT_CANDIDATES = [
  process.env.LRP_HELPER_PATH,
  path.resolve(__dirname, 'k8s', 'component-2', 'apply-local-redirect.sh'),
  path.resolve(__dirname, '..', 'k8s', 'component-2', 'apply-local-redirect.sh'),
  path.resolve(__dirname, '..', '..', 'k8s', 'component-2', 'apply-local-redirect.sh'),
].filter(Boolean);
const APPLY_HELPER_TIMEOUT_MS = Number(process.env.LRP_HELPER_TIMEOUT_MS || 60000);

function normalizePolicy(body, { requireAll } = { requireAll: true }) {
  // Accept clearer alias names and map them to existing fields
  const aliasMap = {
    source_service: 'frontend_service',
    source_port: 'frontend_service_port',
    monitor_selector: 'monitor_pod_contains',
    target_selector: 'redirect_backend_label',
    target_port: 'redirect_backend_port',
    target_protocol: 'redirect_backend_protocol',
  };
  const data = {};
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (body[alias] !== undefined && body[canonical] === undefined) {
      data[canonical] = body[alias];
    }
  }
  for (const key of REQUIRED_POLICY_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.backend_candidate_label !== undefined) data.backend_candidate_label = body.backend_candidate_label;
  if (body.redirect_winner_label !== undefined) data.redirect_winner_label = body.redirect_winner_label;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.choose_best_pod !== undefined) data.choose_best_pod = body.choose_best_pod;
  if (body.strategy !== undefined) data.strategy = body.strategy;

  for (const field of POLICY_NUMERIC_FIELDS) {
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

  if (data.strategy !== undefined) {
    data.strategy = String(data.strategy);
    if (!STRATEGY_VALUES.includes(data.strategy)) {
      return { error: `strategy must be one of: ${STRATEGY_VALUES.join(', ')}` };
    }
  }

  if (data.ttl_seconds !== undefined && data.ttl_seconds <= 0) {
    return { error: 'ttl_seconds must be greater than zero' };
  }

  // Default monitor selector to the frontend service if omitted when requiring all fields
  if (requireAll && data.monitor_pod_contains === undefined && data.frontend_service !== undefined) {
    data.monitor_pod_contains = data.frontend_service;
  }

  const missing = requireAll ? REQUIRED_POLICY_FIELDS.filter((f) => data[f] === undefined) : [];
  if (missing.length) {
    return { error: `Missing required fields: ${missing.join(', ')}` };
  }

  if (requireAll) {
    data.action = data.action || 'redirect';
    data.redirect_backend_protocol = data.redirect_backend_protocol || 'TCP';
    if (data.backend_candidate_label === undefined && data.redirect_backend_label !== undefined) {
      data.backend_candidate_label = data.redirect_backend_label;
    }
    data.redirect_winner_label = data.redirect_winner_label || 'redirect-winner=yes';
    if (data.strategy === undefined && data.choose_best_pod !== undefined) {
      data.strategy = data.choose_best_pod ? 'best_pod' : 'all';
    }
    data.strategy = data.strategy || 'all';
    data.choose_best_pod = data.strategy === 'best_pod';
  } else if (data.strategy === undefined && data.choose_best_pod !== undefined) {
    data.strategy = data.choose_best_pod ? 'best_pod' : 'all';
  } else if (!requireAll && data.strategy !== undefined) {
    data.choose_best_pod = data.strategy === 'best_pod';
  }

  return { data };
}

function normalizeRuleDefinition(body, { requireAll } = { requireAll: true }, policyNameFromPath) {
  const data = {};
  const expectedPolicyName = policyNameFromPath;
  if (expectedPolicyName && requireAll) data.policy_name = expectedPolicyName;
  if (body.policy_name !== undefined) {
    if (expectedPolicyName && body.policy_name !== expectedPolicyName) {
      return { error: 'policy_name in body must match the policy in the URL' };
    }
    data.policy_name = body.policy_name;
  }
  if (!data.policy_name && expectedPolicyName && requireAll) data.policy_name = expectedPolicyName;
  if (body.metric !== undefined) data.metric = body.metric;
  if (body.violation_threshold !== undefined) {
    const num = Number(body.violation_threshold);
    if (!Number.isFinite(num)) {
      return { error: 'violation_threshold must be a number' };
    }
    data.violation_threshold = num;
  }
  if (body.notes !== undefined) data.notes = body.notes;

  const missing = [];
  if (requireAll && !data.policy_name) missing.push('policy_name');
  if (requireAll && data.violation_threshold === undefined) missing.push('violation_threshold');
  if (missing.length) {
    return { error: `Missing required fields: ${missing.join(', ')}` };
  }

  if (data.violation_threshold !== undefined && data.violation_threshold <= 0) {
    return { error: 'violation_threshold must be greater than zero' };
  }

  if (requireAll && data.metric === undefined) {
    data.metric = 'rtt_us';
  }
  return { data };
}

function combinePolicyAndRule(policyDoc, ruleDoc) {
  if (!policyDoc || !ruleDoc) return null;
  const policy = policyDoc.toJSON({ virtuals: false });
  const rule = ruleDoc.toJSON({ virtuals: false });
  return {
    ...policy,
    metric: rule.metric,
    violation_threshold: rule.violation_threshold,
    rule_id: rule.id,
  };
}

const VALID_EVENT_STATUSES = ['applied', 'expired', 'deleted', 'skipped', 'observed'];

async function validateServicePortViaK8sAPI({ namespace, serviceName, expectedPort }) {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';

  if (!host) {
    return { ok: false, error: 'Not running inside Kubernetes (KUBERNETES_SERVICE_HOST missing)' };
  }

  if (!fs.existsSync(tokenPath) || !fs.existsSync(caPath)) {
    return { ok: false, error: 'Service account credentials not found for Kubernetes API access' };
  }

  const token = fs.readFileSync(tokenPath, 'utf8');
  const ca = fs.readFileSync(caPath);

  const requestOptions = {
    hostname: host,
    port,
    path: `/api/v1/namespaces/${namespace}/services/${serviceName}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    ca,
    rejectUnauthorized: true,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({ ok: false, error: `K8s API returned ${res.statusCode}` });
        }
        try {
          const svc = JSON.parse(body);
          const ports = svc?.spec?.ports || [];
          const match = ports.find((p) => Number(p.port) === Number(expectedPort));
          if (!match) {
            return resolve({
              ok: false,
              error: `Service ${serviceName} in ${namespace} does not expose port ${expectedPort}`,
            });
          }
          return resolve({ ok: true });
        } catch (parseErr) {
          return reject(parseErr);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

function validatePortNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return { ok: true };
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, error: `${fieldName} must be an integer port` };
  }
  if (num < 1 || num > 65535) {
    return { ok: false, error: `${fieldName} must be between 1 and 65535` };
  }
  return { ok: true, value: num };
}

function normalizeRedirectionEvent(body) {
  const data = {};
  if (!body.policy_name) return { error: 'policy_name is required' };
  data.policy_name = body.policy_name;
  if (body.frontend_service !== undefined) data.frontend_service = body.frontend_service;
  if (body.planned_backend_service !== undefined) data.planned_backend_service = body.planned_backend_service;
  if (body.planned_backend_label !== undefined) data.planned_backend_label = body.planned_backend_label;
  if (body.planned_backend_port !== undefined) data.planned_backend_port = Number(body.planned_backend_port);
  if (body.final_backend_service !== undefined) data.final_backend_service = body.final_backend_service;
  if (body.final_backend_label !== undefined) data.final_backend_label = body.final_backend_label;
  if (body.final_backend_port !== undefined) data.final_backend_port = Number(body.final_backend_port);
  if (body.redirect_backend_label !== undefined) data.redirect_backend_label = body.redirect_backend_label;
  if (body.redirect_backend_port !== undefined) data.redirect_backend_port = Number(body.redirect_backend_port);
  if (body.accepted_service !== undefined) data.accepted_service = body.accepted_service;
  if (body.notes !== undefined) data.notes = body.notes;

  if (body.violation_triggered === undefined) {
    return { error: 'violation_triggered is required (boolean)' };
  }
  data.violation_triggered =
    typeof body.violation_triggered === 'boolean'
      ? body.violation_triggered
      : String(body.violation_triggered).toLowerCase() === 'true';

  data.status = body.status && VALID_EVENT_STATUSES.includes(body.status) ? body.status : 'applied';

  if (body.occurred_at !== undefined) {
    const d = new Date(body.occurred_at);
    if (Number.isNaN(d.getTime())) return { error: 'occurred_at is not a valid date' };
    data.occurred_at = d;
  }

  return { data };
}

function resolveApplyScript() {
  const match = APPLY_SCRIPT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!match) {
    throw new Error(
      `Local redirect helper not found. Checked: ${APPLY_SCRIPT_CANDIDATES.join(', ')}. Set LRP_HELPER_PATH to override.`
    );
  }
  return match;
}

async function applyLocalRedirectPolicy(policyDoc, ruleDoc) {
  if (!policyDoc || !ruleDoc) {
    throw new Error('Both policy and rule are required to apply a local redirect');
  }
  const scriptPath = resolveApplyScript();

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lrp-rule-'));
  const rulePath = path.join(tempDir, 'rule.json');

  try {
    // Persist rule in the exact JSON shape expected by the helper
    await fs.promises.writeFile(rulePath, JSON.stringify(toRuleFile(policyDoc, ruleDoc), null, 2), 'utf8');

    const env = {
      ...process.env,
      // Optional override to point helper at a non-default telemetry API
      API_URL: process.env.TELEMETRY_API_URL || process.env.API_URL || undefined,
    };

    // Use absolute bash path to avoid PATH issues in minimal images
    const bashCmd = process.env.BASH_PATH || '/bin/bash';
    const { stdout, stderr } = await execFileAsync(bashCmd, [scriptPath, rulePath], {
      env,
      timeout: APPLY_HELPER_TIMEOUT_MS,
    });
    return { stdout, stderr };
  } catch (err) {
    const stdout = err?.stdout?.toString();
    const stderr = err?.stderr?.toString();
    const message = err?.killed
      ? `Helper timed out after ${APPLY_HELPER_TIMEOUT_MS}ms`
      : err?.message || 'Failed to apply local redirect policy';
    const error = new Error(message);
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  } finally {
    // Best-effort cleanup
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function toRuleFile(policyDoc, ruleDoc) {
  const policy = policyDoc.toJSON ? policyDoc.toJSON({ virtuals: false }) : policyDoc;
  const rule = ruleDoc.toJSON ? ruleDoc.toJSON({ virtuals: false }) : ruleDoc;
  const strategy = policy.strategy || (policy.choose_best_pod ? 'best_pod' : 'all');

  return {
    policy_name: policy.policy_name,
    namespace: policy.namespace,
    frontend_service: policy.frontend_service,
    frontend_service_port: String(policy.frontend_service_port),
    monitor_pod_contains: policy.monitor_pod_contains,
    metric: rule.metric,
    violation_threshold: rule.violation_threshold,
    action: policy.action,
    redirect_backend_label: policy.redirect_backend_label,
    redirect_backend_port: String(policy.redirect_backend_port),
    redirect_backend_protocol: policy.redirect_backend_protocol,
    ttl_seconds: policy.ttl_seconds,
    strategy,
    choose_best_pod: strategy === 'best_pod',
    backend_candidate_label: policy.backend_candidate_label,
    redirect_winner_label: policy.redirect_winner_label,
    notes: policy.notes || rule.notes,
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Identity endpoint to match service-a/b/c whoami checks
app.get('/whoami', (_req, res) => {
  const identity = process.env.SERVICE_NAME || os.hostname();
  res.status(200).send(`Hi, I am component2-backend (${identity})\n`);
});

// Proxy whoami for service-a so the frontend can see the redirected backend message
app.get('/api/probe/service-a', async (_req, res) => {
  const target = process.env.SERVICE_A_WHOAMI_URL || 'http://service-a.test-services.svc.cluster.local:5000/whoami';
  try {
    const body = await fetchPlainText(target, 4000);
    res.status(200).send(body);
  } catch (err) {
    const message = err?.message || 'Failed to reach service-a whoami';
    res.status(502).json({ message, target });
  }
});

async function fetchPlainText(targetUrl, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const { protocol } = new URL(targetUrl);
    const client = protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { timeout: timeoutMs }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => {
        data += chunk;
      });
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${targetUrl} timed out after ${timeoutMs}ms`));
    });
  });
}

app.get('/api/policies', async (_req, res, next) => {
  try {
    const policies = await Policy.find().sort({ updatedAt: -1 });
    res.json(policies);
  } catch (err) {
    next(err);
  }
});

app.get('/api/policies/by-name/:policyName', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

app.get('/api/policies/:id', async (req, res, next) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

app.post('/api/policies', async (req, res, next) => {
  try {
    const { data, error } = normalizePolicy(req.body, { requireAll: true });
    if (error) return res.status(400).json({ message: error });

    const policy = await Policy.findOneAndUpdate(
      { policy_name: data.policy_name },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(policy);
  } catch (err) {
    next(err);
  }
});

app.put('/api/policies/:id', async (req, res, next) => {
  try {
    const { data, error } = normalizePolicy(req.body, { requireAll: false });
    if (error) return res.status(400).json({ message: error });
    if (!Object.keys(data).length) return res.status(400).json({ message: 'No fields provided to update' });

    const policy = await Policy.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/policies/:id', async (req, res, next) => {
  try {
    const policy = await Policy.findByIdAndDelete(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    await Rule.findOneAndDelete({ policy_name: policy.policy_name });

    try {
      await RedirectionEvent.create({
        policy_name: policy.policy_name,
        frontend_service: policy.frontend_service,
        redirect_backend_label: policy.redirect_backend_label,
        redirect_backend_port: policy.redirect_backend_port,
        violation_triggered: false,
        status: 'deleted',
        notes: 'Policy deleted via API',
      });
    } catch (eventErr) {
      console.error('Failed to record deletion event', eventErr);
    }

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/policies/:policyName/rule', async (req, res, next) => {
  try {
    const rule = await Rule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found for policy' });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

app.post('/api/policies/:policyName/rule', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    const { data, error } = normalizeRuleDefinition(req.body, { requireAll: true }, policy.policy_name);
    if (error) return res.status(400).json({ message: error });

    const rule = await Rule.findOneAndUpdate(
      { policy_name: policy.policy_name },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

// Apply LocalRedirectPolicy via the helper script using the stored policy + rule
app.post('/api/policies/:policyName/apply', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    const rule = await Rule.findOne({ policy_name: policy.policy_name });
    if (!rule) return res.status(404).json({ message: 'Rule not found for policy' });

    try {
      const result = await applyLocalRedirectPolicy(policy, rule);
      res.json({
        message: `Applied local redirect for policy ${policy.policy_name}`,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      const message = err?.message || 'Failed to apply local redirect policy';
      const stdout = err?.stdout || '';
      const stderr = err?.stderr || '';
      return res.status(500).json({
        message,
        stdout,
        stderr,
        helper: resolveApplyScript(),
        rule: policy.policy_name,
        exitCode: err?.code,
        signal: err?.signal,
      });
    }
  } catch (err) {
    next(err);
  }
});

app.get('/api/policies/:policyName/rule-file', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    const rule = await Rule.findOne({ policy_name: policy.policy_name });
    if (!rule) return res.status(404).json({ message: 'Rule not found for policy' });
    res.json(toRuleFile(policy, rule));
  } catch (err) {
    next(err);
  }
});

// Legacy combined rule endpoints (kept for compatibility with existing callers)
app.get('/api/rules', async (_req, res, next) => {
  try {
    const policies = await Policy.find().sort({ updatedAt: -1 });
    const rules = await Rule.find({ policy_name: { $in: policies.map((p) => p.policy_name) } });
    const ruleMap = new Map(rules.map((r) => [r.policy_name, r]));
    const combined = policies
      .map((policy) => combinePolicyAndRule(policy, ruleMap.get(policy.policy_name)))
      .filter(Boolean);
    res.json(combined);
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/:id', async (req, res, next) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    const rule = await Rule.findOne({ policy_name: policy.policy_name });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(combinePolicyAndRule(policy, rule));
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/by-policy/:policyName', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    const rule = await Rule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(combinePolicyAndRule(policy, rule));
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/:id/rule-file', async (req, res, next) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    const rule = await Rule.findOne({ policy_name: policy.policy_name });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(toRuleFile(policy, rule));
  } catch (err) {
    next(err);
  }
});

app.get('/api/rules/by-policy/:policyName/rule-file', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    const rule = await Rule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(toRuleFile(policy, rule));
  } catch (err) {
    next(err);
  }
});

app.post('/api/rules', async (req, res, next) => {
  try {
    const { data: policyData, error: policyError } = normalizePolicy(req.body, { requireAll: true });
    if (policyError) return res.status(400).json({ message: policyError });
    const { data: ruleData, error: ruleError } = normalizeRuleDefinition(req.body, { requireAll: true }, policyData.policy_name);
    if (ruleError) return res.status(400).json({ message: ruleError });
    ruleData.policy_name = policyData.policy_name;

    const policy = await Policy.findOneAndUpdate(
      { policy_name: policyData.policy_name },
      { $set: policyData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const rule = await Rule.findOneAndUpdate(
      { policy_name: policyData.policy_name },
      { $set: ruleData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(201).json(combinePolicyAndRule(policy, rule));
  } catch (err) {
    next(err);
  }
});

app.put('/api/rules/:id', async (req, res, next) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Rule not found' });

    const { data: policyData, error: policyError } = normalizePolicy(req.body, { requireAll: false });
    if (policyError) return res.status(400).json({ message: policyError });
    const { data: ruleData, error: ruleError } = normalizeRuleDefinition(
      req.body,
      { requireAll: false },
      policy.policy_name
    );
    if (ruleError) return res.status(400).json({ message: ruleError });

    const ruleUpdate = { ...ruleData };
    delete ruleUpdate.policy_name;

    if (!Object.keys(policyData).length && !Object.keys(ruleUpdate).length) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    const updatedPolicy = Object.keys(policyData).length
      ? await Policy.findByIdAndUpdate(req.params.id, { $set: policyData }, { new: true })
      : policy;
    const updatedRule = Object.keys(ruleUpdate).length
      ? await Rule.findOneAndUpdate(
          { policy_name: policy.policy_name },
          { $set: ruleUpdate },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        )
      : await Rule.findOne({ policy_name: policy.policy_name });

    res.json(combinePolicyAndRule(updatedPolicy, updatedRule));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/rules/:id', async (req, res, next) => {
  try {
    const policy = await Policy.findByIdAndDelete(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    await Rule.findOneAndDelete({ policy_name: policy.policy_name });

    try {
      await RedirectionEvent.create({
        policy_name: policy.policy_name,
        frontend_service: policy.frontend_service,
        redirect_backend_label: policy.redirect_backend_label,
        redirect_backend_port: policy.redirect_backend_port,
        violation_triggered: false,
        status: 'deleted',
        notes: 'Policy deleted via API',
      });
    } catch (eventErr) {
      console.error('Failed to record deletion event', eventErr);
    }

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/rules/by-policy/:policyName/apply', async (req, res, next) => {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Rule not found' });
    const rule = await Rule.findOne({ policy_name: req.params.policyName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });

    try {
      const result = await applyLocalRedirectPolicy(policy, rule);
      res.json({
        message: `Applied local redirect for policy ${policy.policy_name}`,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      const message = err?.message || 'Failed to apply local redirect policy';
      const stdout = err?.stdout || '';
      const stderr = err?.stderr || '';
      return res.status(500).json({
        message,
        stdout,
        stderr,
        helper: resolveApplyScript(),
        rule: policy.policy_name,
        exitCode: err?.code,
        signal: err?.signal,
      });
    }
  } catch (err) {
    next(err);
  }
});

// Redirection event log endpoints
app.get('/api/redirections', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.policy_name) filter.policy_name = req.query.policy_name;
    const events = await RedirectionEvent.find(filter).sort({ occurred_at: -1 });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

app.get('/api/redirections/by-policy/:policyName', async (req, res, next) => {
  try {
    const events = await RedirectionEvent.find({ policy_name: req.params.policyName }).sort({ occurred_at: -1 });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

app.post('/api/redirections', async (req, res, next) => {
  try {
    // 1) Validate port numbers are syntactically valid
    const portFields = [
      ['planned_backend_port', req.body.planned_backend_port],
      ['final_backend_port', req.body.final_backend_port],
      ['redirect_backend_port', req.body.redirect_backend_port],
    ];

    for (const [field, value] of portFields) {
      const result = validatePortNumber(value, field);
      if (!result.ok) return res.status(400).json({ message: result.error });
    }

    // 2) Ensure the referenced policy exists so we can cross-check declared ports/labels
    const policy = await Policy.findOne({ policy_name: req.body.policy_name });
    if (!policy) {
      return res.status(404).json({ message: `Policy not found for policy_name ${req.body.policy_name}` });
    }

    const { data, error } = normalizeRedirectionEvent(req.body);
    if (error) return res.status(400).json({ message: error });

    // Cross-check redirect target consistency with the stored rule
    if (data.redirect_backend_port !== undefined) {
      const policyPort = Number(policy.redirect_backend_port);
      if (data.redirect_backend_port !== policyPort) {
        return res
          .status(400)
          .json({ message: `redirect_backend_port must match policy (${policyPort}) for policy ${policy.policy_name}` });
      }
    }
    if (data.final_backend_port !== undefined) {
      const policyPort = Number(policy.redirect_backend_port);
      if (data.final_backend_port !== policyPort) {
        return res
          .status(400)
          .json({ message: `final_backend_port must match policy (${policyPort}) for policy ${policy.policy_name}` });
      }
    }
    if (data.redirect_backend_label && data.redirect_backend_label !== policy.redirect_backend_label) {
      return res
        .status(400)
        .json({
          message: `redirect_backend_label must match policy (${policy.redirect_backend_label}) for policy ${policy.policy_name}`,
        });
    }

    // 3) Optionally enforce live Kubernetes Service port match (opt-in to avoid blocking local dev)
    const shouldValidateK8s = process.env.ENABLE_K8S_PORT_CHECK === 'true';
    if (shouldValidateK8s && data.final_backend_service && policy.namespace) {
      try {
        const matches = await validateServicePortViaK8sAPI({
          namespace: policy.namespace,
          serviceName: data.final_backend_service,
          expectedPort: data.final_backend_port || data.redirect_backend_port || Number(policy.redirect_backend_port),
        });
        if (!matches.ok) {
          return res.status(400).json({ message: matches.error || 'Kubernetes service port validation failed' });
        }
      } catch (k8sErr) {
        return res.status(400).json({ message: `Kubernetes service validation failed: ${k8sErr.message}` });
      }
    }

    const created = await RedirectionEvent.create(data);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Mark a policy as expired (when TTL cleanup or manual expiry occurs)
async function handlePolicyExpiry(req, res, next) {
  try {
    const policy = await Policy.findOne({ policy_name: req.params.policyName });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });

    const { data, error } = normalizeRedirectionEvent({
      policy_name: policy.policy_name,
      frontend_service: policy.frontend_service,
      redirect_backend_label: policy.redirect_backend_label,
      redirect_backend_port: policy.redirect_backend_port,
      violation_triggered: false,
      status: 'expired',
      notes: req.body?.notes || 'Policy TTL expired or was manually expired',
      occurred_at: req.body?.occurred_at,
    });
    if (error) return res.status(400).json({ message: error });

    const created = await RedirectionEvent.create(data);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

app.post('/api/policies/:policyName/expire', handlePolicyExpiry);
app.post('/api/rules/by-policy/:policyName/expire', handlePolicyExpiry);

// Basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[component2-backend] Listening on port ${PORT}`);
});
