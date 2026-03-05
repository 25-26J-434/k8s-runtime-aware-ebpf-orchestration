# How to view daemon logs (e.g. to debug email / notifications)

The eBPF daemon runs as a **DaemonSet** (`ebpf-daemon`) in the **`ebpf-telemetry`** namespace. Its logs show notification and email activity.

## When the daemon runs in Kubernetes

**Important:** Use the namespace `-n ebpf-telemetry` (the daemon is not in `default`).

1. **Find the daemon pod** (one per node):

   ```bash
   kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry
   ```

   You’ll see a pod name like `ebpf-daemon-abc12` or `ebpf-daemon-xyz99`. Use that name in the next step.

2. **Stream logs from one daemon pod** (use the actual pod name from step 1, e.g. `ebpf-daemon-abc12`):

   ```bash
   kubectl logs -f ebpf-daemon-xxxxx -n ebpf-telemetry --tail=200
   ```

   Replace `ebpf-daemon-xxxxx` with your pod name. Example:

   ```bash
   kubectl logs -f ebpf-daemon-abc12 -n ebpf-telemetry --tail=200
   ```

3. **Stream logs from any daemon pod** (without looking up the name):

   ```bash
   kubectl logs -l app=ebpf-daemon -n ebpf-telemetry -f --tail=200
   ```

4. **Search for notification / email lines** (you have 3 daemon pods; the API may hit any one, so check all). Use `[Notification]` so you don’t get unrelated “failed” lines:

   ```bash
   for p in $(kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry -o jsonpath='{.items[*].metadata.name}'); do
     echo "=== $p ==="
     kubectl logs "$p" -n ebpf-telemetry --tail=500 | grep '\[Notification\]'
   done
   ```

5. **Email-only logs from all node pods** (use this to find email issues; all lines are prefixed `[Notification] [EMAIL]`):

   ```bash
   for p in $(kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry -o jsonpath='{.items[*].metadata.name}'); do
     node=$(kubectl get pod "$p" -n ebpf-telemetry -o jsonpath='{.spec.nodeName}')
     echo "========== $p (node: $node) =========="
     kubectl logs "$p" -n ebpf-telemetry --tail=1000 2>/dev/null | grep '\[EMAIL\]' || true
     echo ""
   done
   ```

   **If you see no output:** (1) Rebuild and redeploy the daemon so the new `[EMAIL]` logging is in the running image. (2) Or use the **broader** command below to see any notification activity (config load, TriggerNow, Test, etc.).

   **All notification-related lines from all pods** (broader — works with current and older daemon builds):

   ```bash
   for p in $(kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry -o jsonpath='{.items[*].metadata.name}'); do
     node=$(kubectl get pod "$p" -n ebpf-telemetry -o jsonpath='{.spec.nodeName}')
     echo "========== $p (node: $node) =========="
     kubectl logs "$p" -n ebpf-telemetry --tail=1000 2>/dev/null | grep '\[Notification\]' || true
     echo ""
   done
   ```

   One-liner (email lines only):

   ```bash
   kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry -o name | xargs -I{} sh -c 'echo "=== {} ===" && kubectl logs {} -n ebpf-telemetry --tail=1000 2>/dev/null | grep "\[EMAIL\]" || true'
   ```

   Or stream one pod **live**, then click **Send test notification** in the UI (request might go to that pod or another):

   ```bash
   kubectl logs -f ebpf-daemon-gswmv -n ebpf-telemetry --tail=50
   ```

   (Use any pod name from `kubectl get pods -l app=ebpf-daemon -n ebpf-telemetry`.)

   After clicking **Send test notification** you should see one of:

   - `[Notification] [EMAIL] Test: sending to ... via smtp.gmail.com:587`
   - `[Notification] [EMAIL] Test: sent successfully to N recipient(s)` — email worked
   - `[Notification] [EMAIL] Test FAILED: ...` — error (e.g. smtp auth, dial, starttls)
   - `[Notification] [EMAIL] getEmailConfig: skipped — ...` — config issue (email_enabled, smtp_host, email_to, etc.)

## If you see "No resources found"

- The daemon may not be deployed yet. Deploy it (e.g. from project scripts or `kubectl apply -f k8s/daemonset.yaml`) and ensure the `ebpf-telemetry` namespace exists.
- Or the daemon might be in another namespace. List all pods with the label:
  ```bash
  kubectl get pods -l app=ebpf-daemon -A
  ```
  The second column is the namespace; use that in place of `ebpf-telemetry` in the commands above.

## When the daemon runs locally (e.g. `go run`)

Logs go to **stdout** in the terminal where you started the daemon. Scroll up or re-run the test and watch the same terminal.
