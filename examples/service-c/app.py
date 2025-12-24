#!/usr/bin/env python3
"""
Service C - Extra backend to test multi-backend redirection.
Same behavior as Service B but listens on PORT (default 5003).
"""
import os
import time
import random
from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/")
def home():
    delay = random.uniform(0.001, 0.05)  # 1-50ms
    time.sleep(delay)
    return jsonify({
        "service": "service-c",
        "status": "running",
        "simulated_delay_ms": round(delay * 1000, 2),
        # Clear identifier to verify redirect target
        "message": "Hi, I am service C (alternate backend)"
    })

@app.route("/health")
def health():
    return "OK", 200

@app.route("/slow")
def slow():
    delay = random.uniform(0.1, 0.5)  # 100-500ms
    time.sleep(delay)
    return jsonify({
        "service": "service-c",
        "endpoint": "slow",
        "delay_ms": round(delay * 1000, 2)
    })

@app.route("/data")
def data():
    return jsonify({
        "service": "service-c",
        "data": {
            "timestamp": time.time(),
            "items": [f"item_{i}" for i in range(10)],
            "random_value": random.random()
        }
    })


@app.route("/whoami")
def whoami():
    """Plain text identity to confirm which backend handled the request."""
    return "Hi, I am service C\n", 200, {"Content-Type": "text/plain"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5003))
    app.run(host="0.0.0.0", port=port, debug=False)
