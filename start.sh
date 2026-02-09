#!/bin/bash

# NullTrace Local - Start Script (macOS / Linux)
# On macOS: double-click start.command instead
# On Linux:  ./start.sh

PROJECT_ROOT=$(pwd)
SERVER_DIR="$PROJECT_ROOT/server"
CLIENT_DIR="$PROJECT_ROOT/client"

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo "Stopping NullTrace Local..."
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

echo "========================================"
echo "   NullTrace Local"
echo "========================================"
echo ""

# 1. Verify Server Bundle
echo "[*] Checking server bundle..."
if [ ! -f "$SERVER_DIR/dist/server.js" ]; then
    echo "ERROR: Server bundle not found at server/dist/server.js"
    echo "Please ensure you have the complete repository with the pre-built server bundle."
    exit 1
fi

# 2. Install Server Dependencies
echo "[*] Checking server dependencies..."
if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo "    Installing server dependencies..."
    cd "$SERVER_DIR"
    npm install --omit=dev
    cd "$PROJECT_ROOT"
fi

# 3. Install Client Dependencies
echo "[*] Checking client dependencies..."
if [ ! -d "$CLIENT_DIR/node_modules" ]; then
    echo "    Installing client dependencies..."
    cd "$CLIENT_DIR"
    npm install
    cd "$PROJECT_ROOT"
fi

# 4. Check for .env configuration
if [ ! -f "$SERVER_DIR/.env" ]; then
    echo ""
    echo "[!] No .env file found in server/"
    echo "    Copying .env.example -> .env (using default public RPC)"
    echo "    For better performance, edit server/.env with your own RPC URL"
    cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
    echo ""
fi

# 5. Start Application
echo "[*] Starting services..."
echo ""

# Start Server in background
echo "-> Starting Local API Server (Port 3003)..."
cd "$SERVER_DIR"
npm start &
SERVER_PID=$!

# Wait for server to warm up
sleep 2

# Start Client
echo "-> Starting Web Interface (Port 5173)..."
echo ""
echo "========================================"
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:3003"
echo "========================================"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

cd "$CLIENT_DIR"
npm run dev &
CLIENT_PID=$!

# Keep script running to maintain background processes
wait $SERVER_PID $CLIENT_PID
