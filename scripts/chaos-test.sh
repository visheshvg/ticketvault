#!/bin/bash
set -e

echo "🔥 TicketVault Chaos Test"
echo "========================"
echo ""

if [ -z "$EVENT_ID" ] || [ -z "$AUTH_TOKEN" ] || [ -z "$SEAT_IDS" ]; then
  echo "Error: Missing required env vars. Run scripts/seed-load-test.sh first."
  echo "Usage: EVENT_ID=<uuid> SEAT_IDS=<csv> AUTH_TOKEN=<token> ./scripts/chaos-test.sh"
  exit 1
fi

echo "→ Starting 200 VU load test in background..."
EVENT_ID=$EVENT_ID SEAT_IDS=$SEAT_IDS AUTH_TOKEN=$AUTH_TOKEN \
  k6 run --vus 200 --duration 30s scripts/load-test.js &
K6_PID=$!

echo "→ Waiting 5s for load to ramp up..."
sleep 5

echo "→ Injecting chaos: stopping Redis container..."
docker compose stop redis

echo "→ Redis stopped. Watching backend circuit breaker for 8s..."
sleep 8
docker compose logs --tail=30 backend | grep -E "circuit|redis|error|degraded" || echo "  (no circuit events yet — check full logs)"

echo ""
echo "→ Restoring Redis..."
docker compose start redis

echo "→ Waiting for Redis reconnection..."
sleep 4
docker compose logs --tail=10 backend | grep -E "reconnect|connect|redis" || true

echo ""
echo "→ Waiting for load test to complete..."
wait $K6_PID

echo ""
echo "✅ Chaos test complete."
echo ""
echo "Validate:"
echo "  SELECT COUNT(*), seat_id FROM bookings WHERE status IN ('pending','confirmed') GROUP BY seat_id HAVING COUNT(*) > 1;"
echo "  → Should return 0 rows (no double-bookings)"
