#!/usr/bin/env bash
set -euo pipefail

# Locked defaults (override via env only when required)
SERVICE_NAME="${LIVE_EMIT_WS_SERVICE_NAME:-thelab-live-emit-ws}"
REGION="${LIVE_EMIT_WS_REGION:-us-central1}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: GOOGLE_CLOUD_PROJECT is required (or set gcloud default project)." >&2
  exit 1
fi

APP_BASE_URL="${APP_BASE_URL:-}"
SESSION_VALIDATE_URL="${LIVE_EMIT_SESSION_VALIDATE_URL:-}"
if [[ -z "${SESSION_VALIDATE_URL}" ]]; then
  if [[ -z "${APP_BASE_URL}" ]]; then
    echo "ERROR: set LIVE_EMIT_SESSION_VALIDATE_URL or APP_BASE_URL." >&2
    exit 1
  fi
  SESSION_VALIDATE_URL="${APP_BASE_URL%/}/api/live-emit/session/validate"
fi

ALLOWED_ORIGINS="${LIVE_EMIT_WS_ALLOWED_ORIGINS:-}"
if [[ -z "${ALLOWED_ORIGINS}" ]]; then
  if [[ -z "${APP_BASE_URL}" ]]; then
    echo "ERROR: set LIVE_EMIT_WS_ALLOWED_ORIGINS or APP_BASE_URL." >&2
    exit 1
  fi
  ALLOWED_ORIGINS="${APP_BASE_URL}"
fi

MODEL="${GEMINI_LIVE_EMIT_MODEL:-gemini-3.1-pro-preview}"
DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
VERSION="${LIVE_EMIT_WS_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
MIN_INSTANCES="${LIVE_EMIT_WS_MIN_INSTANCES:-0}"
MAX_INSTANCES="${LIVE_EMIT_WS_MAX_INSTANCES:-20}"
TIMEOUT="${LIVE_EMIT_WS_TIMEOUT:-900s}"

ENV_VARS=(
  "LIVE_EMIT_SESSION_VALIDATE_URL=${SESSION_VALIDATE_URL}"
  "LIVE_EMIT_WS_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
  "GEMINI_LIVE_EMIT_MODEL=${MODEL}"
  "LIVE_EMIT_WS_DEPLOYED_AT=${DEPLOYED_AT}"
  "LIVE_EMIT_WS_VERSION=${VERSION}"
)

SET_ENV_VARS="$(IFS=,; echo "${ENV_VARS[*]}")"

DEPLOY_CMD=(
  gcloud run deploy "${SERVICE_NAME}"
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --source .
  --allow-unauthenticated
  --port 8080
  --cpu 1
  --memory 512Mi
  --timeout "${TIMEOUT}"
  --min-instances "${MIN_INSTANCES}"
  --max-instances "${MAX_INSTANCES}"
  --command npm
  --args run,live-emit:ws
  --set-env-vars "${SET_ENV_VARS}"
)

if [[ -n "${LIVE_EMIT_SESSION_VALIDATE_AUTH_SECRET:-}" ]]; then
  DEPLOY_CMD+=(
    --set-secrets "LIVE_EMIT_SESSION_VALIDATE_AUTH=${LIVE_EMIT_SESSION_VALIDATE_AUTH_SECRET}:latest"
  )
elif [[ -n "${LIVE_EMIT_SESSION_VALIDATE_AUTH:-}" ]]; then
  DEPLOY_CMD+=(
    --set-env-vars "LIVE_EMIT_SESSION_VALIDATE_AUTH=${LIVE_EMIT_SESSION_VALIDATE_AUTH}"
  )
fi

echo "Deploying ${SERVICE_NAME} to ${PROJECT_ID}/${REGION}"
echo "  validate_url=${SESSION_VALIDATE_URL}"
echo "  allowed_origins=${ALLOWED_ORIGINS}"
echo "  version=${VERSION}"
echo "  deployed_at=${DEPLOYED_AT}"

"${DEPLOY_CMD[@]}"

SERVICE_URL="$(
  gcloud run services describe "${SERVICE_NAME}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(status.url)'
)"

echo ""
echo "Live Emit WS deployed."
echo "Service URL: ${SERVICE_URL}"
echo "WebSocket URL: ${SERVICE_URL/https:/wss:}/ws/live-emit"
