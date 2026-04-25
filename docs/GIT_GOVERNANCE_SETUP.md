# Git Governance Deployment Setup

This document defines the required runtime setup for Git-as-Governance (`src/lib/git-governance/engine.ts`).

## Required Environment Contract

The runtime now requires:

- `GOOGLE_CLOUD_PROJECT`
- `VERTEX_AI_AYAOPS_URL_DATASTORE`
- `GITHUB_TOKEN`

`GITHUB_TOKEN` is loaded with `requireEnv()` and must be present at runtime.

## Secret Manager Setup (one-time)

Create the secret:

```bash
gcloud secrets create github-token \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --replication-policy="automatic"
```

Add a secret version from your local GitHub token:

```bash
printf "%s" "$GITHUB_TOKEN" | gcloud secrets versions add github-token \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --data-file=-
```

## Grant Cloud Run Service Access

Identify the runtime service account:

```bash
SERVICE_ACCOUNT="$(gcloud run services describe gemini3-chat \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region us-central1 \
  --format='value(spec.template.spec.serviceAccountName)')"

if [ -z "$SERVICE_ACCOUNT" ]; then
  PROJECT_NUMBER="$(gcloud projects describe "$GOOGLE_CLOUD_PROJECT" --format='value(projectNumber)')"
  SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

echo "$SERVICE_ACCOUNT"
```

Grant Secret Manager accessor:

```bash
gcloud secrets add-iam-policy-binding github-token \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"
```

## Deploy Script Usage

Set the secret name expected by `deploy-gemini3-chat.sh`:

```bash
export GITHUB_TOKEN_SECRET=github-token
```

Deploy:

```bash
./deploy-gemini3-chat.sh
```

The script binds:

```bash
--set-secrets "GITHUB_TOKEN=${GITHUB_TOKEN_SECRET}:latest"
```

## Rotation

Rotate token by adding a new secret version:

```bash
printf "%s" "$GITHUB_TOKEN" | gcloud secrets versions add github-token \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --data-file=-
```

Cloud Run picks up the latest secret version on next deployment/revision.
