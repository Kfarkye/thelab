#!/bin/bash
set -e
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/google-cloud-sdk/bin:$PATH"

if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  echo "CRITICAL BOOT FAILURE: Missing required environment variable: GOOGLE_CLOUD_PROJECT"
  exit 1
fi

if [[ -z "${VERTEX_AI_AYAOPS_URL_DATASTORE:-}" ]]; then
  echo "CRITICAL BOOT FAILURE: Missing required environment variable: VERTEX_AI_AYAOPS_URL_DATASTORE"
  exit 1
fi

if [[ -z "${GITHUB_TOKEN_SECRET:-}" ]]; then
  echo "CRITICAL BOOT FAILURE: Missing required environment variable: GITHUB_TOKEN_SECRET"
  echo "Set this to the Secret Manager secret name that stores the GitHub token."
  exit 1
fi

IMAGE="us-central1-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/cloud-run-source-deploy/gemini3-chat:latest"

echo "1. Building image and resolving Next.js UI edge UI routes..."
docker build --no-cache --platform linux/amd64 -t $IMAGE .

echo "2. Pushing to Artifact Registry..."
docker push $IMAGE

echo "3. Deploying to Cloud Run..."
gcloud run deploy gemini3-chat \
  --image $IMAGE \
  --region us-central1 \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --platform managed \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},VERTEX_AI_AYAOPS_URL_DATASTORE=${VERTEX_AI_AYAOPS_URL_DATASTORE}" \
  --set-secrets "GITHUB_TOKEN=${GITHUB_TOKEN_SECRET}:latest" \
  --quiet

echo "Deployment complete."
