#!/bin/bash
set -e

BASE="${BASE_URL:-http://localhost:3000}"
SEATS="${SEATS:-10}"

echo "TicketVault — Load Test Seeder"
echo "==============================="
echo ""

echo "→ Logging in as admin..."
LOGIN=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ticketvault.com","password":"admin123"}')

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "  Token obtained."

echo ""
echo "→ Creating test event with $SEATS seats..."
EVENT=$(curl -sf -X POST "$BASE/api/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"Load Test Event $(date +%s)\",
    \"venue\": \"Test Arena\",
    \"total_seats\": $SEATS,
    \"base_price\": 50.00,
    \"starts_at\": \"$(date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+7d '+%Y-%m-%dT%H:%M:%SZ')\",
    \"ends_at\": \"$(date -u -d '+7 days 3 hours' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+7d -v+3H '+%Y-%m-%dT%H:%M:%SZ')\"
  }")

EVENT_ID=$(echo "$EVENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['event']['id'])")
echo "  Event ID: $EVENT_ID"

echo ""
echo "→ Fetching seat IDs..."
SEATS_DATA=$(curl -sf "$BASE/api/events/$EVENT_ID/seats")
SEAT_IDS=$(echo "$SEATS_DATA" | python3 -c "import sys,json; print(','.join(s['id'] for s in json.load(sys.stdin)['seats']))")
echo "  Got $(echo "$SEAT_IDS" | tr ',' '\n' | wc -l | tr -d ' ') seats."

echo ""
echo "================================================================"
echo "Run load test:"
echo ""
echo "  EVENT_ID=$EVENT_ID \\"
echo "  SEAT_IDS=$SEAT_IDS \\"
echo "  AUTH_TOKEN=$TOKEN \\"
echo "  k6 run scripts/load-test.js"
echo ""
echo "Run chaos test:"
echo ""
echo "  EVENT_ID=$EVENT_ID \\"
echo "  SEAT_IDS=$SEAT_IDS \\"
echo "  AUTH_TOKEN=$TOKEN \\"
echo "  ./scripts/chaos-test.sh"
echo "================================================================"
