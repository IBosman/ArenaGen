#!/bin/bash

# Stop all running servers

echo "🛑 Stopping all servers..."

# Read PIDs from file if exists
if [ -f ".pids" ]; then
    while read pid; do
        if ps -p $pid > /dev/null 2>&1; then
            echo "   Killing process $pid"
            kill -9 $pid 2>/dev/null
        fi
    done < .pids
    rm .pids
fi

# Also kill by port just to be sure
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3002 | xargs kill -9 2>/dev/null

echo "✅ All servers stopped"
