const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const os = require('os');
const http = require('http');
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
    'mongodb+srv://kernelEye:root@cluster0.n2rdrcb.mongodb.net/rulesdb?appName=Cluster0';

const APPLY_HELPER_TIMEOUT_MS = Number(process.env.LRP_HELPER_TIMEOUT_MS || 60000);
const KUBECTL = process.env.KUBECTL_PATH || 'kubectl';
const KUBECTL_TIMEOUT_MS = Number(process.env.KUBECTL_TIMEOUT_MS || 20000);
const TTL_SWEEP_MS = Number(process.env.TTL_SWEEP_MS || 30000);

async function kubectlJson(args) {
    const { stdout } = await execFileAsync(KUBECTL, args, { timeout: KUBECTL_TIMEOUT_MS });
    return JSON.parse(stdout);
}

async function kubectlText(args) {
    const { stdout } = await execFileAsync(KUBECTL, args, { timeout: KUBECTL_TIMEOUT_MS });
    return stdout.trim();
}

function pick(obj, keys) {
    const out = {};
    for (const k of keys) out[k] = obj?.[k];
    return out;
}

function getContainerPorts(pod) {
    const containers = pod?.spec?.containers || [];
    return containers.map((c) => ({
        name: c.name,
        ports: (c.ports || []).map((p) => ({
            name: p.name,
            containerPort: p.containerPort,
            protocol: p.protocol || 'TCP',
        })),
    }));
}

function svcPorts(svc) {
    const ports = svc?.spec?.ports || [];
    return ports.map((p) => ({
        name: p.name,
        port: p.port,
        targetPort: p.targetPort,
        protocol: p.protocol || 'TCP',
    }));
}

function buildEndpointsByService(endpointSlices) {
    // endpointSlice: discovery.k8s.io/v1
    // We map by {namespace}/{serviceName} => list of addresses + ports
    const map = new Map();

    for (const es of endpointSlices?.items || []) {
        const ns = es?.metadata?.namespace;
        const svcName = es?.metadata?.labels?.['kubernetes.io/service-name'];
        if (!ns || !svcName) continue;

        const key = `${ns}/${svcName}`;
        if (!map.has(key)) map.set(key, []);

        const ports = (es.ports || []).map((p) => ({
            name: p.name,
            port: p.port,
            protocol: p.protocol || 'TCP',
        }));

        const endpoints = es.endpoints || [];
        for (const ep of endpoints) {
            const addrs = ep.addresses || [];
            const targetRef = ep.targetRef
                ? pick(ep.targetRef, ['kind', 'name', 'namespace'])
                : null;

            for (const addr of addrs) {
                map.get(key).push({
                    address: addr,
                    ports,
                    targetRef,
                    conditions: ep.conditions || {},
                });
            }
        }
    }

    return map;
}

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

function probeService(host, port, probePath = '/whoami') {
    return new Promise((resolve, reject) => {
        const req = http.get({ host, port, path: probePath, timeout: 4000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Probe timeout'));
        });
    });
}

async function expirePolicyDoc(p, trigger = 'manual') {
    const helper = resolveHelper();
    const bashCmd = process.env.BASH_PATH || '/bin/bash';
    try {
        const { stdout, stderr } = await execFileAsync(bashCmd, [helper, '--delete', p.namespace, p.policy_name], {
            env: process.env,
            timeout: APPLY_HELPER_TIMEOUT_MS,
        });

        p.status = p.status || {};
        p.status.last_expired_at = new Date();
        p.status.last_decision = 'EXPIRED';
        p.status.last_error = null;

        pushHistory(p, 'EXPIRED', 'LRP deleted', { stdout, stderr, trigger });
        await p.save();

        return { stdout, stderr };
    } catch (err) {
        p.status = p.status || {};
        p.status.last_error = err.message;
        pushHistory(p, 'ERROR', `Expire failed: ${err.message}`, { trigger });
        await p.save();
        throw err;
    }
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

function normalizeUpdatePayload(body) {
    // Partial update allowed: only validate fields that exist
    const data = {};

    if (body.namespace !== undefined) data.namespace = String(body.namespace);

    // frontend
    const frontend_service = body.frontend?.service ?? body.frontend_service;
    const frontend_port = body.frontend?.port ?? body.frontend_port ?? body.frontend_service_port;
    if (frontend_service !== undefined || frontend_port !== undefined) {
        data.frontend = {};
        if (frontend_service !== undefined) data.frontend.service = String(frontend_service);
        if (frontend_port !== undefined) {
            const fpErr = validatePort(frontend_port, 'frontend.port');
            if (fpErr) return { error: fpErr };
            data.frontend.port = Number(frontend_port);
        }
    }

    // telemetry
    const metric = body.telemetry?.metric ?? body.metric;
    const violation_threshold = body.telemetry?.violation_threshold ?? body.violation_threshold;
    const monitor_pod_contains = body.telemetry?.monitor_pod_contains ?? body.monitor_pod_contains;

    if (metric !== undefined || violation_threshold !== undefined || monitor_pod_contains !== undefined) {
        data.telemetry = {};
        if (metric !== undefined) {
            if (!['rtt_us', 'dns_us', 'sched_latency_us'].includes(String(metric))) {
                return { error: 'metric must be one of: rtt_us, dns_us, sched_latency_us' };
            }
            data.telemetry.metric = String(metric);
        }
        if (violation_threshold !== undefined) {
            const th = Number(violation_threshold);
            if (!Number.isFinite(th) || th <= 0) return { error: 'violation_threshold must be a positive number' };
            data.telemetry.violation_threshold = th;
        }
        if (monitor_pod_contains !== undefined) data.telemetry.monitor_pod_contains = String(monitor_pod_contains);
    }

    // action
    const action_type = body.action?.type ?? body.action;
    const backend_selector = body.action?.backend_selector ?? body.redirect_backend_label ?? body.backend_selector;
    const backend_port = body.action?.backend_port ?? body.redirect_backend_port ?? body.backend_port;
    const protocol = body.action?.protocol ?? body.redirect_backend_protocol;
    const ttl_seconds = body.action?.ttl_seconds ?? body.ttl_seconds;
    const strategy = body.action?.strategy ?? body.strategy;
    const backend_candidates_selector = body.action?.backend_candidates_selector ?? body.backend_candidate_label;
    const winner_label = body.action?.winner_label ?? body.redirect_winner_label;

    if (
        action_type !== undefined ||
        backend_selector !== undefined ||
        backend_port !== undefined ||
        protocol !== undefined ||
        ttl_seconds !== undefined ||
        strategy !== undefined ||
        backend_candidates_selector !== undefined ||
        winner_label !== undefined
    ) {
        data.action = {};

        if (action_type !== undefined) data.action.type = String(action_type);

        if (backend_selector !== undefined) {
            const sel = parseSelector(String(backend_selector));
            if (!sel.ok) return { error: sel.error };
            data.action.backend_selector = String(backend_selector);
        }

        if (backend_port !== undefined) {
            const bpErr = validatePort(backend_port, 'backend_port');
            if (bpErr) return { error: bpErr };
            data.action.backend_port = Number(backend_port);
        }

        if (protocol !== undefined) data.action.protocol = String(protocol);

        if (ttl_seconds !== undefined) {
            const ttl = Number(ttl_seconds);
            if (!Number.isFinite(ttl) || ttl <= 0) return { error: 'ttl_seconds must be a positive number' };
            data.action.ttl_seconds = ttl;
        }

        if (strategy !== undefined) {
            if (!['all', 'best_pod'].includes(String(strategy))) {
                return { error: 'strategy must be one of: all, best_pod' };
            }
            data.action.strategy = String(strategy);
        }

        if (backend_candidates_selector !== undefined) data.action.backend_candidates_selector = String(backend_candidates_selector);

        if (winner_label !== undefined) {
            if (String(winner_label) && !String(winner_label).includes('=')) {
                return { error: 'winner_label must be key=value (example: redirect-winner=yes)' };
            }
            data.action.winner_label = String(winner_label);
        }
    }

    if (!Object.keys(data).length) return { error: 'No fields provided to update' };

    return { data };
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

// Probe any service's /whoami (or custom path) from inside the cluster.
// Example: /api/probe/traffic-generator?port=5002&namespace=test-services&path=/whoami
// You can override DNS by passing ?host=<ip-or-host>.
app.get('/api/probe/:service', async (req, res) => {
    const service = req.params.service;
    const port = Number(req.query.port) || 5000;
    const namespace = req.query.namespace || 'default';
    const pathParam = req.query.path || '/whoami';
    const hostOverride = req.query.host;
    const host = hostOverride || `${service}.${namespace}.svc.cluster.local`;

    try {
        const result = await probeService(host, port, pathParam);
        res.status(result.status || 200).send(result.body);
    } catch (err) {
        res.status(500).json({ message: err?.message || 'Probe failed' });
    }
});

/**
 * CREATE / UPSERT policy (single collection)
 */
app.post('/api/policies', async (req, res) => {
    const { data, error } = normalizeCreatePayload(req.body);
    if (error) return res.status(400).json({ message: error });

    const exists = await Policy.findOne({ policy_name: data.policy_name });
    if (exists) {
        return res.status(409).json({ message: `Policy ${data.policy_name} already exists. Use PUT /api/policies/${data.policy_name} to edit.` });
    }

    const doc = new Policy(data);
    pushHistory(doc, 'CREATED', 'Policy created', { policy_name: data.policy_name });
    await doc.save();

    res.status(201).json(doc);
});

app.put('/api/policies/:name', async (req, res) => {
    const p = await Policy.findOne({ policy_name: req.params.name });
    if (!p) return res.status(404).json({ message: 'Policy not found' });

    const { data, error } = normalizeUpdatePayload(req.body);
    if (error) return res.status(400).json({ message: error });

    // Merge safely (only provided fields)
    if (data.namespace !== undefined) p.namespace = data.namespace;

    if (data.frontend) {
        p.frontend = p.frontend || {};
        if (data.frontend.service !== undefined) p.frontend.service = data.frontend.service;
        if (data.frontend.port !== undefined) p.frontend.port = data.frontend.port;
    }

    if (data.telemetry) {
        p.telemetry = p.telemetry || {};
        if (data.telemetry.metric !== undefined) p.telemetry.metric = data.telemetry.metric;
        if (data.telemetry.violation_threshold !== undefined) p.telemetry.violation_threshold = data.telemetry.violation_threshold;
        if (data.telemetry.monitor_pod_contains !== undefined) p.telemetry.monitor_pod_contains = data.telemetry.monitor_pod_contains;
    }

    if (data.action) {
        p.action = p.action || {};
        if (data.action.type !== undefined) p.action.type = data.action.type;
        if (data.action.backend_selector !== undefined) p.action.backend_selector = data.action.backend_selector;
        if (data.action.backend_port !== undefined) p.action.backend_port = data.action.backend_port;
        if (data.action.protocol !== undefined) p.action.protocol = data.action.protocol;
        if (data.action.ttl_seconds !== undefined) p.action.ttl_seconds = data.action.ttl_seconds;
        if (data.action.strategy !== undefined) p.action.strategy = data.action.strategy;
        if (data.action.backend_candidates_selector !== undefined) p.action.backend_candidates_selector = data.action.backend_candidates_selector;
        if (data.action.winner_label !== undefined) p.action.winner_label = data.action.winner_label;
    }

    // Good default: if telemetry.monitor_pod_contains missing, set it to frontend.service
    if (!p.telemetry.monitor_pod_contains) p.telemetry.monitor_pod_contains = p.frontend.service;

    pushHistory(p, 'UPDATED', 'Policy updated', { updatedFields: Object.keys(data) });
    await p.save();

    res.json(p);
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
    const backendSelector = p.action?.backend_selector || '';
    const backendName = backendSelector.includes('=')
        ? backendSelector.split('=')[1]
        : backendSelector || 'selected backend';

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
        const applied = result.stdout?.toLowerCase?.().includes('redirect applied');
        const friendly = applied
            ? `Policy applied. Hi, I am ${backendName}`
            : 'Policy evaluated (no redirection applied)';
        const cleanedStdout = (result.stdout || '')
            .split('\n')
            .filter((line) => !line.toLowerCase().includes('cilium'))
            .join('\n')
            .trim();
        res.json({
            message: friendly,
            applied,
            target_backend: backendName,
            ttl_seconds: p.action?.ttl_seconds ?? null,
            details: applied
                ? [`Redirect policy applied`, `Target backend: ${backendName}`]
                : ['No redirect applied'],
            stdout: cleanedStdout,
            stderr: result.stderr,
        });
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
        const { stdout, stderr } = await expirePolicyDoc(p, 'manual');
        res.json({ message: 'Expired (LRP deleted)', stdout, stderr });
    } catch (err) {
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
/**
 * GET /api/cluster/summary
 * Query params:
 *   ?namespace=test-services (optional; if omitted, returns all namespaces)
 */
app.get('/api/cluster/summary', async (req, res) => {
    try {
        const onlyNs = req.query.namespace ? String(req.query.namespace) : null;

        // Cluster/context info
        const context = await kubectlText(['config', 'current-context']).catch(() => '');
        const clusterInfo = await kubectlText(['cluster-info']).catch(() => '');

        // Nodes
        const nodesJson = await kubectlJson(['get', 'nodes', '-o', 'json']);
        const nodes = (nodesJson.items || []).map((n) => ({
            name: n.metadata?.name,
            labels: n.metadata?.labels || {},
            internalIP:
                (n.status?.addresses || []).find((a) => a.type === 'InternalIP')?.address || null,
            roles: Object.keys(n.metadata?.labels || {})
                .filter((k) => k.startsWith('node-role.kubernetes.io/'))
                .map((k) => k.replace('node-role.kubernetes.io/', '')),
            kubeletVersion: n.status?.nodeInfo?.kubeletVersion,
            osImage: n.status?.nodeInfo?.osImage,
        }));

        // Namespaces
        const nsJson = await kubectlJson(['get', 'namespaces', '-o', 'json']);
        const namespaces = (nsJson.items || [])
            .map((n) => n.metadata?.name)
            .filter(Boolean)
            .filter((n) => (onlyNs ? n === onlyNs : true));

        // Pods (all or one namespace)
        const podsArgs = onlyNs
            ? ['get', 'pods', '-n', onlyNs, '-o', 'json']
            : ['get', 'pods', '-A', '-o', 'json'];
        const podsJson = await kubectlJson(podsArgs);
        const pods = (podsJson.items || []).map((p) => ({
            namespace: p.metadata?.namespace,
            name: p.metadata?.name,
            node: p.spec?.nodeName,
            podIP: p.status?.podIP,
            phase: p.status?.phase,
            labels: p.metadata?.labels || {},
            containers: getContainerPorts(p),
        }));

        // Services (ports)
        const svcArgs = onlyNs
            ? ['get', 'svc', '-n', onlyNs, '-o', 'json']
            : ['get', 'svc', '-A', '-o', 'json'];
        const svcJson = await kubectlJson(svcArgs);
        const services = (svcJson.items || []).map((s) => ({
            namespace: s.metadata?.namespace,
            name: s.metadata?.name,
            type: s.spec?.type,
            clusterIP: s.spec?.clusterIP,
            selector: s.spec?.selector || {},
            ports: svcPorts(s),
        }));

        // EndpointSlices (real backend addresses+ports behind services)
        const epsArgs = onlyNs
            ? ['get', 'endpointslices.discovery.k8s.io', '-n', onlyNs, '-o', 'json']
            : ['get', 'endpointslices.discovery.k8s.io', '-A', '-o', 'json'];
        const epsJson = await kubectlJson(epsArgs);
        const endpointsBySvc = buildEndpointsByService(epsJson);

        // Merge endpoints into service list
        const servicesWithEndpoints = services.map((svc) => {
            const key = `${svc.namespace}/${svc.name}`;
            return {
                ...svc,
                endpoints: endpointsBySvc.get(key) || [],
            };
        });

        res.json({
            cluster: {
                context,
                clusterInfo,
            },
            nodes,
            namespaces,
            pods,
            services: servicesWithEndpoints,
        });
    } catch (err) {
        res.status(500).json({
            message: 'Failed to build cluster summary',
            error: err.message || String(err),
        });
    }
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
});

let ttlSweepRunning = false;

async function sweepExpiringPolicies() {
    if (ttlSweepRunning) return;
    ttlSweepRunning = true;
    try {
        const now = Date.now();
        const policies = await Policy.find({ 'action.ttl_seconds': { $gt: 0 } });

        for (const p of policies) {
            const anchor =
                p.status?.last_applied_at ||
                p.status?.last_evaluated_at ||
                p.updatedAt ||
                p.createdAt;

            const ttlMs = (p.action?.ttl_seconds || 0) * 1000;
            if (!anchor || !ttlMs) continue;

            const due = new Date(anchor).getTime() + ttlMs;
            if (due <= now && p.status?.last_decision !== 'EXPIRED') {
                try {
                    await expirePolicyDoc(p, 'auto-ttl');
                } catch (err) {
                    console.error(`Auto TTL expire failed for ${p.policy_name}:`, err.message || err);
                }
            }
        }
    } catch (err) {
        console.error('TTL sweep error:', err);
    } finally {
        ttlSweepRunning = false;
    }
}

setInterval(sweepExpiringPolicies, TTL_SWEEP_MS);
// kick off once on startup
sweepExpiringPolicies().catch((err) => console.error('Initial TTL sweep error:', err));

app.listen(PORT, () => console.log(`[component2-backend] Listening on port ${PORT}`));
