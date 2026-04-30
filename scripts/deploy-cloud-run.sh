#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
PROJECT_ID="$(gcloud config get-value project)"
REGION="${CLOUD_RUN_REGION:-us-central1}"
SERVICE_NAME="thelab-${ENVIRONMENT}"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"
SERVICE_ACCOUNT="thelab-run-sa@${PROJECT_ID}.iam.gserviceaccount.com"
GIT_COMMIT="$(git rev-parse --short HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Deploying ${SERVICE_NAME} to Cloud Run"
echo "Building image with Cloud Build: ${IMAGE_TAG}"

gcloud builds submit \
  --project "${PROJECT_ID}" \
  --tag "${IMAGE_TAG}" \
  .

echo "Deploying service ${SERVICE_NAME}"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --image "${IMAGE_TAG}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 2 \
  --memory 2Gi \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 3600 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCP_PROJECT_ID=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,SPANNER_DATABASE=recruitingdb,NEXT_PUBLIC_GIT_COMMIT=${GIT_COMMIT},NEXT_PUBLIC_GIT_BRANCH=${GIT_BRANCH},CHAT_ENABLE_TOOLS=true" \
  --set-secrets "WEBHOOK_SECRET=WEBHOOK_SECRET:latest,GITHUB_WEBHOOK_SECRET=GITHUB_WEBHOOK_SECRET:latest,GITHUB_TOKEN=github-token:latest,SPANNER_INSTANCE_ID=SPANNER_INSTANCE_ID:latest,EVIDENCE_BUCKET=EVIDENCE_BUCKET:latest,VERTEX_AI_AYAOPS_URL_DATASTORE=VERTEX_AI_AYAOPS_URL_DATASTORE:latest,VERTEX_AI_REPO_DATASTORE_PATH=VERTEX_AI_REPO_DATASTORE_PATH:latest,VERTEX_SEARCH_DATASTORE_ID=VERTEX_SEARCH_DATASTORE_ID:latest,DISCOVERY_GCS_BUCKET=DISCOVERY_GCS_BUCKET:latest,GEMINI_CHAT_MODEL=GEMINI_CHAT_MODEL:latest,GEMINI_REPO_MODEL=GEMINI_REPO_MODEL:latest"

echo "Deployment complete: ${SERVICE_NAME}"
