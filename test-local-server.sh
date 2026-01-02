#!/bin/bash

# Simple script to test Task Master MCP HTTP server locally
# Usage: ./test-local-server.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

echo "🧪 Testing Task Master MCP HTTP Server Locally"
echo ""

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $ENV_FILE"
    exit 1
fi

# Load MISTRAL_API_KEY from .env
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | grep MISTRAL_API_KEY | xargs)
fi

if [ -z "$MISTRAL_API_KEY" ]; then
    echo "❌ MISTRAL_API_KEY not set in .env file"
    exit 1
fi

# Set environment variables
export HOST=0.0.0.0
export PORT=3004
export MCP_ENDPOINT=/mcp
export STORAGE_ROOT="$PROJECT_ROOT/data/taskmaster-test"
export TASK_MASTER_TOOLS=standard
export TASK_MASTER_MCP=true

echo "📋 Configuration:"
echo "   Host: $HOST"
echo "   Port: $PORT"
echo "   Endpoint: $MCP_ENDPOINT"
echo "   Storage: $STORAGE_ROOT"
echo ""

# Check if dist/mcp-server.js exists
if [ ! -f "$SCRIPT_DIR/dist/mcp-server.js" ]; then
    echo "🔨 Building server..."
    cd "$SCRIPT_DIR"
    npm run build
fi

echo "🚀 Starting server..."
echo "   Press Ctrl+C to stop"
echo ""

# Start the server
cd "$SCRIPT_DIR"
node dist/mcp-server.js



















