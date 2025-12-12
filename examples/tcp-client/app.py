#!/usr/bin/env python3
"""
TCP Client Test Service
Makes periodic TCP connections to test RTT measurement
"""
import os
import time
import requests
import threading
from flask import Flask, jsonify

app = Flask(__name__)

# Configuration
TARGET_SERVICES = [
    "http://service-a.test-services.svc.cluster.local:5000",
    "http://service-b.test-services.svc.cluster.local:5001",
    "http://www.google.com",
    "http://www.github.com",
]

def make_tcp_connection(url):
    """Make a TCP connection (HTTP request)"""
    try:
        start = time.time()
        response = requests.get(url, timeout=5)
        elapsed = (time.time() - start) * 1000  # Convert to ms
        return {
            "url": url,
            "status": response.status_code,
            "latency_ms": round(elapsed, 2),
            "success": True
        }
    except Exception as e:
        return {
            "url": url,
            "error": str(e),
            "success": False
        }

def continuous_tcp_connections():
    """Continuously make TCP connections"""
    while True:
        for url in TARGET_SERVICES:
            result = make_tcp_connection(url)
            if result.get("success"):
                print(f"[TCP] {result['url']} - {result['latency_ms']}ms")
            else:
                print(f"[TCP] {result['url']} - Error: {result.get('error')}")
            time.sleep(2)  # Wait 2 seconds between connections

@app.route('/')
def index():
    return jsonify({
        "service": "tcp-client",
        "description": "Makes TCP connections to test RTT measurement",
        "targets": TARGET_SERVICES
    })

@app.route('/health')
def health():
    return jsonify({"status": "healthy"})

@app.route('/test')
def test():
    """Make a test connection"""
    results = []
    for url in TARGET_SERVICES:
        result = make_tcp_connection(url)
        results.append(result)
    return jsonify({"connections": results})

if __name__ == '__main__':
    # Start background thread for continuous connections
    thread = threading.Thread(target=continuous_tcp_connections, daemon=True)
    thread.start()
    
    # Start Flask server
    app.run(host='0.0.0.0', port=5002, debug=False)


