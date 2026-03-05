#!/bin/bash

# Port-forward Watchdog Script
# Automatically restarts kubectl port-forward if it dies
# Restarts within 1 second of detection

set -euo pipefail

NAMESPACE="ebpf-telemetry"
TARGET="svc/ebpf-daemon"
LOCAL_PORT="8080"
REMOTE_PORT="8080"
LOG_FILE="/tmp/port-forward-watchdog.log"
PF_LOG_FILE="/tmp/port-forward.log"
CHECK_INTERVAL=1  # Check every 1 second

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if port-forward is running
is_port_forward_running() {
    pgrep -f "kubectl.*port-forward.*${TARGET}.*${LOCAL_PORT}" > /dev/null 2>&1
}

# Check if port is actually accessible
is_port_accessible() {
    curl -s -f -m 1 "http://localhost:${LOCAL_PORT}/health" > /dev/null 2>&1
}

# Start port-forward
start_port_forward() {
    log "${GREEN}Starting port-forward...${NC}"
    
    # Kill any existing port-forwards first
    pkill -f "kubectl.*port-forward.*${TARGET}.*${LOCAL_PORT}" 2>/dev/null || true
    sleep 0.2
    
    # Start new port-forward in background
    kubectl -n "$NAMESPACE" port-forward "${TARGET}" "${LOCAL_PORT}:${REMOTE_PORT}" > "$PF_LOG_FILE" 2>&1 &
    
    # Wait a moment for it to start
    sleep 0.5
    
    # Verify it started
    if is_port_forward_running; then
        log "${GREEN}✓ Port-forward started successfully (PID: $(pgrep -f "kubectl.*port-forward.*${TARGET}.*${LOCAL_PORT}"))${NC}"
        return 0
    else
        log "${RED}✗ Failed to start port-forward${NC}"
        return 1
    fi
}

# Stop port-forward
stop_port_forward() {
    log "${YELLOW}Stopping port-forward...${NC}"
    pkill -f "kubectl.*port-forward.*${TARGET}.*${LOCAL_PORT}" 2>/dev/null || true
    sleep 0.2
}

# Signal handler for cleanup
cleanup() {
    log "${YELLOW}Shutting down watchdog...${NC}"
    stop_port_forward
    exit 0
}

# Trap signals
trap cleanup SIGINT SIGTERM

# Main watchdog loop
main() {
    log "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    log "${GREEN}Port-Forward Watchdog Started${NC}"
    log "${GREEN}Monitoring: ${NAMESPACE}/${TARGET}:${REMOTE_PORT} -> localhost:${LOCAL_PORT}${NC}"
    log "${GREEN}Check interval: ${CHECK_INTERVAL} second(s)${NC}"
    log "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    
    # Start initial port-forward
    if ! is_port_forward_running; then
        start_port_forward
    fi
    
    local consecutive_failures=0
    local max_failures=3
    
    # Main monitoring loop
    while true; do
        if ! is_port_forward_running; then
            log "${RED}⚠ Port-forward process not running!${NC}"
            consecutive_failures=$((consecutive_failures + 1))
            
            if [ $consecutive_failures -ge $max_failures ]; then
                log "${YELLOW}Multiple failures detected, restarting...${NC}"
                start_port_forward
                consecutive_failures=0
            fi
        elif ! is_port_accessible; then
            log "${YELLOW}⚠ Port-forward running but port not accessible!${NC}"
            consecutive_failures=$((consecutive_failures + 1))
            
            if [ $consecutive_failures -ge $max_failures ]; then
                log "${YELLOW}Port not accessible, restarting port-forward...${NC}"
                stop_port_forward
                sleep 0.3
                start_port_forward
                consecutive_failures=0
            fi
        else
            # Everything is working
            if [ $consecutive_failures -gt 0 ]; then
                log "${GREEN}✓ Port-forward recovered!${NC}"
                consecutive_failures=0
            fi
        fi
        
        sleep "$CHECK_INTERVAL"
    done
}

# Run main function
main

