import { RoutingPlayground } from '../components/RoutingPlayground';
import { RoutingCharts } from '../components/RoutingCharts';
import { IntentRuleBuilder } from '../components/IntentRuleBuilder';
import './Page.css';

export function Routing() {
    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Intelligent Traffic Routing</h1>
                    <p className="page-subtitle">Latency-aware pod selection and traffic distribution on the existing Kind (Docker) cluster</p>
                </div>
            </div>

            <div className="page-content">
                <RoutingPlayground />
                <RoutingCharts />
                <IntentRuleBuilder />

                <div className="feature-card">
                    <h2>Component Overview</h2>
                    <p>
                        Component 2 rides on the existing Kind cluster (<code>k8s/kind-config.yaml</code>, name: <code>ebpf-cluster</code>) and uses Cilium to route pod-to-pod traffic on the same node.
                        The routing logic can consume telemetry either in-process or via the daemon's REST API.
                    </p>
                </div>

                <div className="info-grid">
                    <div className="info-card">
                        <h3>Cluster + Cilium (Docker/Kind)</h3>
                        <p>Use the repo's Kind cluster and install Cilium as the CNI (all pods land on the single node → same-node datapath).</p>
                        <pre className="code-block">
{`# Ensure context
kubectl config use-context kind-ebpf-cluster

# Install Cilium and wait for green
cilium install
cilium status --wait`}
                        </pre>
                        <p className="helper-text">
                            If any Cilium pod is Pending, check <code>kubectl get pods -n kube-system</code> and <code>kubectl describe -n kube-system -l k8s-app=cilium</code>.
                        </p>
                    </div>

                    <div className="info-card">
                        <h3>Generate Same-Node Traffic</h3>
                        <p>Use the existing test services and images already loaded into Kind.</p>
                        <pre className="code-block">
{`kubectl apply -f k8s/test-services.yaml
kubectl wait --for=condition=ready pod -n test-services -l app=service-a --timeout=90s
kubectl wait --for=condition=ready pod -n test-services -l app=service-b --timeout=90s
kubectl get pods -n test-services -o wide  # all on ebpf-cluster-control-plane`}
                        </pre>
                        <p className="helper-text">The CronJob keeps sending traffic to service-a → service-b to feed telemetry.</p>
                    </div>

                    <div className="info-card">
                        <h3>REST-Driven Routing (quick path)</h3>
                        <p>Pull metrics over HTTP, pick the best pod, and send traffic to it.</p>
                        <pre className="code-block">
{`# Forward daemon API
kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080

# Pick best service-a pod by DNS latency
BEST=$(curl -s http://localhost:8080/metrics/json | jq -r '
  .dns.pods
  | to_entries
  | map(select(.key|startswith("test-services/service-a")))
  | min_by(.value.avg_latency_us)
  | .key')
POD=$(echo "$BEST" | cut -d'/' -f2)
IP=$(kubectl -n test-services get pod "$POD" -o jsonpath="{.status.podIP}")

# (Optional) install curl once in service-a, then send traffic
kubectl -n test-services exec deploy/service-a -- sh -c "apt-get update && apt-get install -y curl"
kubectl -n test-services exec deploy/service-a -- curl -s "http://$IP:5001/health"`}
                        </pre>
                        <p className="helper-text">
                            All traffic is same-node; with Cilium installed, the eBPF datapath handles routing and policy.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
