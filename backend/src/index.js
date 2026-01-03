const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { execFile } = require('child_process');
require('dotenv').config();

const Policy = require('./models/Policy');

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

const execFileAsync = util.promisify(execFile);

const PORT = Number(process.env.PORT || 4000);
const MONGODB_URI =
    process.env.MONGODB_URI ||
    'mongodb+srv://kernelEye:root@cluster0.n2rdrcb.mongodb.net/?appName=Cluster0';

const APPLY_HELPER_TIMEOUT_MS = Number(process.env.LRP_HELPER_TIMEOUT_MS || 60000);

// Helper script is at repo root (same folder level as Dockerfile) in your screenshot
const HELPER_PATHS = [
    process.env.LRP_HELPER_PATH,
    path.resolve(__dirname, '..', 'apply-local-redirect.sh'),
].filter(Boolean);

function resolveHelper() {
    const found = HELPER_PATHS.find((p) => fs.existsSync(p));
    if (!found) {
        throw new Error(`apply-local-redirect.sh not found. Checked: ${HELPER_PATHS.join(', ')}`);
    }
    return found;
}

function pushHistory(doc, event, message, data) {
    doc.history = doc.history || [];
    doc.history.unshift({ event, message, data, ts: new Date() });
    // keep last 50 only
    if (doc.history.length > 50) doc.history = doc.history.slice(0, 50);
}

function parseSelector(selector) {
    // expects "key=value"
    if (!selector || typeof selector !== 'string' || !selector.includes('=')) {
        return { ok: false, error: 'backend_selector must be in key=value format (example: app=service-c)' };
    }
    const [k, v] = selector.split('=');
    if (!k || !v) return { ok: false, error: 'backend_selector must be in key=value format (example: app=service-c)' };
    return { ok: true, key: k.trim(), value: v.trim() };
}

function validatePort(port, field) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return `${field} must be an integer between 1 and 65535`;
    return null;
}

function normalizeCreatePayload(body) {
    // This lets you create policy with a single request.
    // Accept both flat and nested payload shapes.

    const policy_name = body.policy_name;
    const namespace = body.namespace;

    // frontend fields
    const frontend_service = body.frontend?.service ?? body.frontend_service;
    const frontend_port = body.frontend?.port ?? body.frontend_service_port ?? body.frontend_port;

    // telemetry fields
    const metric = body.telemetry?.metric ?? body.metric ?? 'rtt_us';
    const violation_threshold = body.telemetry?.violation_threshold ?? body.violation_threshold;
    const monitor_pod_contains =
        body.telemetry?.monitor_pod_contains ??
        body.monitor_pod_contains ??
        body.monitor_selector ??
        frontend_service;

    // action fields
    const action_type = body.action?.type ?? body.action ?? 'redirect';
    const backend_selector = body.action?.backend_selector ?? body.redirect_backend_label ?? body.backend_selector;
    const backend_port = body.action?.backend_port ?? body.redirect_backend_port ?? body.backend_port;
    const protocol = body.action?.protocol ?? body.redirect_backend_protocol ?? 'TCP';
    const ttl_seconds = body.action?.ttl_seconds ?? body.ttl_seconds;

    const strategy = body.action?.strategy ?? body.strategy ?? 'all';
    const backend_candidates_selector = body.action?.backend_candidates_selector ?? body.backend_candidate_label;
    const winner_label = body.action?.winner_label ?? body.redirect_winner_label ?? 'redirect-winner=yes';

    const missing = [];
    if (!policy_name) missing.push('policy_name');
    if (!namespace) missing.push('namespace');
    if (!frontend_service) missing.push('frontend.service (or frontend_service)');
    if (frontend_port === undefined) missing.push('frontend.port (or frontend_port)');
    if (violation_threshold === undefined) missing.push('violation_threshold');
    if (!backend_selector) missing.push('backend_selector (or redirect_backend_label)');
    if (backend_port === undefined) missing.push('backend_port (or redirect_backend_port)');
    if (ttl_seconds === undefined) missing.push('ttl_seconds');

    if (missing.length) return { error: `Missing required fields: ${missing.join(', ')}` };

    const fpErr = validatePort(frontend_port, 'frontend.port');
    if (fpErr) return { error: fpErr };
    const bpErr = validatePort(backend_port, 'backend_port');
    if (bpErr) return { error: bpErr };

    const ttl = Number(ttl_seconds);
    if (!Number.isFinite(ttl) || ttl <= 0) return { error: 'ttl_seconds must be a positive number' };

    const th = Number(violation_threshold);
    if (!Number.isFinite(th) || th <= 0) return { error: 'violation_threshold must be a positive number' };

    if (!['rtt_us', 'dns_us', 'sched_latency_us'].includes(String(metric))) {
        return { error: 'metric must be one of: rtt_us, dns_us, sched_latency_us' };
    }

    if (!['all', 'best_pod'].includes(String(strategy))) {
        return { error: 'strategy must be one of: all, best_pod' };
    }

    if (String(strategy) === 'best_pod') {
        // candidates selector is required for best-pod mode
        if (!backend_candidates_selector) {
            return { error: 'backend_candidates_selector is required when strategy=best_pod' };
        }
        if (!String(winner_label).includes('=')) {
            return { error: 'winner_label must be key=value (example: redirect-winner=yes)' };
        }
    }

    // Validate selector format now (backend_selector or winner_label/candidates are still validated in helper too)
    const sel = parseSelector(backend_selector);
    if (!sel.ok) return { error: sel.error };

    return {
        data: {
            policy_name: String(policy_name),
            namespace: String(namespace),
            frontend: { service: String(frontend_service), port: Number(frontend_port) },
            telemetry: {
                metric: String(metric),
                violation_threshold: th,
                monitor_pod_contains: String(monitor_pod_contains || frontend_service),
            },
            action: {
                type: String(action_type || 'redirect'),
                backend_selector: String(backend_selector),
                backend_port: Number(backend_port),
                protocol: String(protocol || 'TCP'),
                ttl_seconds: ttl,
                strategy: String(strategy),
                backend_candidates_selector: backend_candidates_selector ? String(backend_candidates_selector) : undefined,
                winner_label: String(winner_label),
            },
        },
    };
}

function toRuleFile(policyDoc) {
    // Keep helper JSON compatible (very close to your old helper)
    const p = policyDoc.toJSON ? policyDoc.toJSON() : policyDoc;

    return {
        policy_name: p.policy_name,
        namespace: p.namespace,

        frontend_service: p.frontend.service,
        frontend_service_port: String(p.frontend.port),

        monitor_pod_contains: p.telemetry.monitor_pod_contains || p.frontend.service,
        metric: p.telemetry.metric,
        violation_threshold: p.telemetry.violation_threshold,

        action: p.action.type, // "redirect"
        redirect_backend_label: p.action.backend_selector, // label selector key=value
        redirect_backend_port: String(p.action.backend_port),
        redirect_backend_protocol: p.action.protocol,
        ttl_seconds: p.action.ttl_seconds,

        strategy: p.action.strategy,
        choose_best_pod: p.action.strategy === 'best_pod',

        backend_candidate_label: p.action.backend_candidates_selector || p.action.backend_selector,
        redirect_winner_label: p.action.winner_label,
    };
}

async function runHelperWithRule(ruleObj) {
    const helper = resolveHelper();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lrp-'));
    const rulePath = path.join(tempDir, 'rule.json');

    try {
        await fs.promises.writeFile(rulePath, JSON.stringify(ruleObj, null, 2), 'utf8');

        const env = {
            ...process.env,
            // Your helper uses TELEMETRY_BASE_URL or API_URL
            TELEMETRY_BASE_URL: process.env.TELEMETRY_BASE_URL || 'http://127.0.0.1:8080',
        };

        const bashCmd = process.env.BASH_PATH || '/bin/bash';
        const { stdout, stderr } = await execFileAsync(bashCmd, [helper, rulePath], {
            env,
            timeout: APPLY_HELPER_TIMEOUT_MS,
        });
        return { stdout, stderr };
    } catch (err) {
        const message = err?.killed
            ? `Helper timed out after ${APPLY_HELPER_TIMEOUT_MS}ms`
            : err?.message || 'Helper failed';
        const e = new Error(message);
        e.stdout = err?.stdout?.toString?.() || '';
        e.stderr = err?.stderr?.toString?.() || '';
        throw e;
    } finally {
        fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

mongoose
    .connect(MONGODB_URI)
    .then(() => console.log(`[component2-backend] Connected to MongoDB at ${MONGODB_URI}`))
    .catch((err) => {
        console.error('[component2-backend] MongoDB connection failed', err);
        process.exit(1);
    });

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/whoami', (_req, res) => {
    const identity = process.env.SERVICE_NAME || os.hostname();
    res.status(200).send(`Hi, I am component2-backend (${identity})\n`);
});

/**
 * CREATE / UPSERT policy (single collection)
 */
app.post('/api/policies', async (req, res) => {
    const { data, error } = normalizeCreatePayload(req.body);
    if (error) return res.status(400).json({ message: error });

    const existing = await Policy.findOne({ policy_name: data.policy_name });
    const doc = existing || new Policy(data);

    // merge on upsert (if exists)
    if (existing) {
        doc.namespace = data.namespace;
        doc.frontend = data.frontend;
        doc.telemetry = data.telemetry;
        doc.action = data.action;
    }

    pushHistory(doc, existing ? 'UPDATED' : 'CREATED', 'Policy saved', {
        policy_name: data.policy_name,
    });

    await doc.save();
    res.status(existing ? 200 : 201).json(doc);
});

/**
 * LIST policies
 */
app.get('/api/policies', async (_req, res) => {
    const items = await Policy.find().sort({ updatedAt: -1 });
    res.json(items);
});

/**
 * GET policy
 */
app.get('/api/policies/:name', async (req, res) => {
    const p = await Policy.findOne({ policy_name: req.params.name });
    if (!p) return res.status(404).json({ message: 'Policy not found' });
    res.json(p);
});

/**
 * APPLY/EVALUATE: runs helper, updates status/history
 */
app.post('/api/policies/:name/evaluate', async (req, res) => {
    const p = await Policy.findOne({ policy_name: req.params.name });
    if (!p) return res.status(404).json({ message: 'Policy not found' });

    const rule = toRuleFile(p);

    try {
        const result = await runHelperWithRule(rule);

        p.status = p.status || {};
        p.status.last_evaluated_at = new Date();
        p.status.last_decision = 'APPLIED'; // helper applies only when violation happens (otherwise it exits)
        p.status.last_applied_at = new Date();
        p.status.last_helper_stdout = result.stdout;
        p.status.last_helper_stderr = result.stderr;
        p.status.last_error = null;

        pushHistory(p, 'EVALUATED', 'Helper executed', { rule });
        pushHistory(p, 'APPLIED', 'LocalRedirectPolicy applied (if violation)', {
            stdout: result.stdout?.slice?.(0, 2000),
            stderr: result.stderr?.slice?.(0, 2000),
        });

        await p.save();
        res.json({ message: 'Evaluate executed (helper decides apply/skip)', stdout: result.stdout, stderr: result.stderr });
    } catch (err) {
        p.status = p.status || {};
        p.status.last_evaluated_at = new Date();
        p.status.last_decision = 'ERROR';
        p.status.last_error = err.message;
        p.status.last_helper_stdout = err.stdout || '';
        p.status.last_helper_stderr = err.stderr || '';

        pushHistory(p, 'ERROR', err.message, { stdout: err.stdout, stderr: err.stderr });
        await p.save();

        res.status(500).json({
            message: err.message,
            stdout: err.stdout || '',
            stderr: err.stderr || '',
            helper: resolveHelper(),
        });
    }
});

/**
 * EXPIRE: mark expired + delete LRP (we call helper in "delete mode")
 * (Helper below supports: ./apply-local-redirect.sh --delete <namespace> <policy_name>)
 */
app.post('/api/policies/:name/expire', async (req, res) => {
    const p = await Policy.findOne({ policy_name: req.params.name });
    if (!p) return res.status(404).json({ message: 'Policy not found' });

    try {
        const helper = resolveHelper();
        const bashCmd = process.env.BASH_PATH || '/bin/bash';
        const { stdout, stderr } = await execFileAsync(bashCmd, [helper, '--delete', p.namespace, p.policy_name], {
            env: process.env,
            timeout: APPLY_HELPER_TIMEOUT_MS,
        });

        p.status = p.status || {};
        p.status.last_expired_at = new Date();
        p.status.last_decision = 'EXPIRED';
        p.status.last_error = null;

        pushHistory(p, 'EXPIRED', 'LRP deleted', { stdout, stderr });
        await p.save();

        res.json({ message: 'Expired (LRP deleted)', stdout, stderr });
    } catch (err) {
        p.status = p.status || {};
        p.status.last_error = err.message;
        pushHistory(p, 'ERROR', `Expire failed: ${err.message}`);
        await p.save();

        res.status(500).json({ message: `Expire failed: ${err.message}` });
    }
});

/**
 * DELETE policy doc + best-effort expire
 */
app.delete('/api/policies/:name', async (req, res) => {
    const p = await Policy.findOne({ policy_name: req.params.name });
    if (!p) return res.status(404).json({ message: 'Policy not found' });

    // best-effort delete LRP
    try {
        const helper = resolveHelper();
        const bashCmd = process.env.BASH_PATH || '/bin/bash';
        await execFileAsync(bashCmd, [helper, '--delete', p.namespace, p.policy_name], {
            env: process.env,
            timeout: APPLY_HELPER_TIMEOUT_MS,
        });
    } catch (_) {
        // ignore
    }

    await Policy.deleteOne({ policy_name: req.params.name });
    res.json({ deleted: true });
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => console.log(`[component2-backend] Listening on port ${PORT}`));
