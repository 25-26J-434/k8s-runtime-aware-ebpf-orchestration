#!/usr/bin/env python3
"""
Service B - Test Service for eBPF Telemetry
This is the target service that Service A calls
"""
import os
import time
import random
from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/")
def home():
    # Add variable delay to simulate real-world latency
    delay = random.uniform(0.001, 0.05)  # 1-50ms
    time.sleep(delay)
    return jsonify({
        "service": "service-b",
        "status": "running",
        "simulated_delay_ms": round(delay * 1000, 2),
        "message": "eBPF Telemetry Test Service B"
    })

@app.route("/health")
def health():
    return "OK", 200

@app.route("/slow")
def slow():
    """Endpoint with intentional delay for RTT testing"""
    delay = random.uniform(0.1, 0.5)  # 100-500ms
    time.sleep(delay)
    return jsonify({
        "service": "service-b",
        "endpoint": "slow",
        "delay_ms": round(delay * 1000, 2)
    })

@app.route("/data")
def data():
    """Return some sample data"""
    return jsonify({
        "service": "service-b",
        "data": {
            "timestamp": time.time(),
            "items": [f"item_{i}" for i in range(10)],
            "random_value": random.random()
        }
    })

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)

