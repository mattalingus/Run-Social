#!/bin/bash
# Integration test: POST /api/users/find-by-contacts
# Registers a temporary user, verifies HTTP 200 response, then cleans up.
set -e

BASE="${1:-http://localhost:5000}"
COOKIE_JAR=$(mktemp)
TS=$(date +%s)
EMAIL="contacts_test_${TS}@test.com"
USER_ID=""

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

# 1. Register a test user to get an authenticated session
REG=$(curl -sf "$BASE/api/auth/register" \
  -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -d "{\"firstName\":\"CI\",\"lastName\":\"Test\",\"email\":\"$EMAIL\",\"password\":\"TestPass123!\",\"username\":\"ci_test_$TS\"}")
USER_ID=$(echo "$REG" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "Registered user: $USER_ID"

# 2. POST with a valid SHA-256 hash — must return HTTP 200
DUMMY_HASH=$(echo -n "paceup:5559990000" | sha256sum | awk '{print $1}')
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  -X POST "$BASE/api/users/find-by-contacts" \
  -H "Content-Type: application/json" \
  -d "{\"phoneHashes\":[\"$DUMMY_HASH\"]}")

if [ "$STATUS" = "200" ]; then
  echo "PASS: POST /api/users/find-by-contacts returned $STATUS (authenticated)"
else
  echo "FAIL: expected 200, got $STATUS"
  exit 1
fi

# 3. Without auth — must return 401
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/users/find-by-contacts" \
  -H "Content-Type: application/json" \
  -d "{\"phoneHashes\":[\"$DUMMY_HASH\"]}")
if [ "$UNAUTH" = "401" ]; then
  echo "PASS: unauthenticated caller returns $UNAUTH"
else
  echo "FAIL: expected 401, got $UNAUTH"
  exit 1
fi
