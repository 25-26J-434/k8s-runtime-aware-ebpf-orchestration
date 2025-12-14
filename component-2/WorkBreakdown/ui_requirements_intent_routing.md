# UI Requirements for Intent-Aware Routing Component  
This UI must clearly display **Before → After** behavior across all three layers of the intelligent routing system.

---

## 1️⃣ Telemetry Layer (Before vs After)

Telemetry = live network metrics collected from Component 1 (eBPF telemetry).

### BEFORE (Healthy State)
Display baseline network conditions:
- DNS resolution time (e.g., **23 ms**)
- TCP handshake latency (e.g., **80 ms**)
- Packet retransmissions (e.g., **0**)
- Active backend route (e.g., **Service B1**)

### AFTER (Degraded State)
Show updated metrics when performance drops:
- DNS delay increased (e.g., **240 ms**)
- TCP handshake latency **exceeds threshold**  
  (e.g., **180 ms > 100 ms**)
- Packet retransmissions increased (e.g., **0 → 7**)
- Active backend route changed  
  (e.g., **Service B1 → Service B2**)

### Purpose
This section must make it clear:
- What the telemetry was **before** the violation.
- What changed that **triggered** the intent evaluation.

These metrics match the research plan requirement to log:
**DNS delay, TCP latency, retransmissions.**

---

## 2️⃣ Intent Decision Layer (Before vs After)

This section shows how the system evaluates telemetry **against the intent policy**.

### BEFORE (No Violation)
Show:
- Loaded intent policy:
  ```json
  { "intent": "low-latency", "threshold_ms": 100, "action": "reroute" }
  ```
- Decision: **“Within threshold → No action”**
- Comparison details:
  - Measured latency (e.g., **80 ms**)
  - Threshold (e.g., **100 ms**)

### AFTER (Violation Detected)
Show:
- Trigger metric:  
  (e.g., **Latency = 150 ms > 100 ms**)
- Decision: **“Threshold violated → REROUTE triggered”**
- Highlight violation (e.g., red indicator, alert banner)

### Purpose
This proves:
- The system is **intent-aware**.
- The routing engine compares telemetry with policy rules.

This aligns with the **Routing Intelligence Layer** of the research plan.

---

## 3️⃣ Routing Enforcement Layer (Before vs After)

This section visualizes the **actual routing action** taken by the eBPF layer.

### BEFORE (Normal Routing)
Show:
- Active route: **Service B1**
- No reroute triggered
- Kernel logs (optional):
  - `"Intercepted TCP connection"`

### AFTER (Reroute Applied)
Show:
- New route: **Service B2**
- Reroute event timestamp
- Kernel/eBPF logs confirming the action
- (Optional) Improved metrics after reroute:
  - e.g., latency drops from **180 ms → 73 ms**

### Purpose
This visualizes the core of the research:
- **Real-time, kernel-level service-to-service routing**  
- Based on intent evaluation + telemetry changes

---

# Summary for UI Developer

Your UI must contain **three sections**, each showing **Before vs After**:

---

### A. Telemetry View
- DNS delay, TCP latency, retransmissions, active backend  
- Clearly highlight changes that caused the intent violation

### B. Intent Decision View
- Intent policy (thresholds + action)
- System decision: no action vs reroute triggered
- Highlight threshold violations

### C. Routing Enforcement View
- Routing path before (Service B1)
- Routing path after (Service B2)
- Reroute timestamp
- Kernel log confirmations

---

### Overall Flow Illustrated by the UI
1. **What was happening?** → Telemetry  
2. **What did the system decide?** → Intent Decision  
3. **What changed in the network?** → Routing Enforcement  
