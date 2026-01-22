#!/bin/bash
set -e

# Set project root to the daemon directory
PROJECT_ROOT="$(cd "$(dirname "$0")/daemon" && pwd)"
cd "$PROJECT_ROOT"

# Step 1: Build Go daemon binary
if [ ! -f ebpf-daemon ]; then
  echo "[1/4] Building Go daemon binary..."
  go build -o ebpf-daemon ./cmd/daemon
  echo "Go daemon built."
else
  echo "[1/4] Go daemon binary already exists."
fi

# Step 2: Build Docker image
IMAGE_NAME="ebpf-daemon:local"


# Step 2: Check if Docker image exists, skip build
if [[ "$(docker images -q $IMAGE_NAME)" == "" ]]; then
  echo "[2/4] Docker image $IMAGE_NAME does not exist. Please build it manually before running this script."
  exit 1
else
  echo "[2/4] Docker image already exists: $IMAGE_NAME"
fi

# Step 3: Run Docker container
CONTAINER_NAME="ebpf-daemon-test"
PORT=8080

# Stop and remove any existing container with the same name
if [ $(docker ps -aq -f name=$CONTAINER_NAME) ]; then
  echo "[3/4] Removing existing container..."
  docker rm -f $CONTAINER_NAME
fi

echo "[4/4] Starting new container..."
docker run -d --name $CONTAINER_NAME -p $PORT:8080 --privileged $IMAGE_NAME

echo "Container started: $CONTAINER_NAME (http://localhost:$PORT)"
