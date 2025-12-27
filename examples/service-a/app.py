#!/usr/bin/env python3
"""
Service A - Test Service for eBPF Telemetry
This service makes DNS lookups and HTTP calls to test DNS/RTT collection
"""
import os
import time
import socket
import requests
from flask import Flask, jsonify

app = Flask(__name__)

SERVICE_B_URL = os.getenv("SERVICE_B_URL", "http://service-b:5001")
DNS_TEST_DOMAINS = ["google.com", "kubernetes.default.svc.cluster.local", "service-b"]

# @app.route("/")
# def home():
#     return jsonify({
#         "service": "service-a",
#         "status": "running",
#         "message": "eBPF Telemetry Test Service A"
#     })

# app.py in service-a
@app.route("/")
def root():
    return jsonify({
        "message": "Hello from backend",
        "served_by": os.environ.get("SERVICE_NAME", "unknown")
    })

@app.route("/whoami")
def whoami():
    """Plain text identity to match service-b/service-c behavior."""
    identity = os.environ.get("SERVICE_NAME", socket.gethostname())
    return f"Hi, I am service A ({identity})\n", 200, {"Content-Type": "text/plain"}

@app.route("/health")
def health():
    return "OK", 200

@app.route("/dns-test")
def dns_test():
    """Perform DNS lookups to generate DNS telemetry events"""
    results = []
    for domain in DNS_TEST_DOMAINS:
        try:
            start = time.time()
            ip = socket.gethostbyname(domain)
            elapsed = (time.time() - start) * 1000  # ms
            results.append({
                "domain": domain,
                "ip": ip,
                "latency_ms": round(elapsed, 2),
                "status": "success"
            })
        except socket.gaierror as e:
            results.append({
                "domain": domain,
                "error": str(e),
                "status": "failed"
            })
    return jsonify({"dns_lookups": results})

@app.route("/call-service-b")
def call_service_b():
    """Make HTTP call to service-b to generate RTT telemetry"""
    try:
        start = time.time()
        response = requests.get(f"{SERVICE_B_URL}/", timeout=5)
        elapsed = (time.time() - start) * 1000  # ms
        return jsonify({
            "target": "service-b",
            "status_code": response.status_code,
            "latency_ms": round(elapsed, 2),
            "response": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
        })
    except requests.RequestException as e:
        return jsonify({
            "target": "service-b",
            "error": str(e),
            "status": "failed"
        }), 500

@app.route("/load-test/<int:count>")
def load_test(count):
    """Generate multiple DNS and HTTP requests for load testing"""
    dns_results = []
    http_results = []
    
    for i in range(count):
        # DNS lookup
        try:
            socket.gethostbyname("kubernetes.default.svc.cluster.local")
            dns_results.append("success")
        except:
            dns_results.append("failed")
        
        # HTTP call
        try:
            requests.get(f"{SERVICE_B_URL}/health", timeout=2)
            http_results.append("success")
        except:
            http_results.append("failed")
    
    return jsonify({
        "iterations": count,
        "dns_success": dns_results.count("success"),
        "dns_failed": dns_results.count("failed"),
        "http_success": http_results.count("success"),
        "http_failed": http_results.count("failed")
    })

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
