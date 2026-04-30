# Google Cloud Run Deployment

The Lab runs as a standalone Next.js container on Google Cloud Run. This keeps the web runtime inside the same Google Cloud IAM boundary as Spanner, Vertex AI, Discovery Engine, Cloud Storage, and Secret Manager.

## Runtime

- Compute: Cloud Run
- Next.js packaging: `output: "standalone"`
- Container port: `8080`
- Runtime identity: `thelab-run-sa`
- Health endpoint: `/api/health`

## Deploy

Use Cloud Build instead of local Docker so the image is built on Google infrastructure with the target architecture.

```bash
npm run deploy:cloudrun:staging
```

The deploy script builds and deploys `thelab-staging` by default:

```bash
bash scripts/deploy-cloud-run.sh staging
```

## Required Secrets

These Secret Manager entries must exist before deploy:

- `WEBHOOK_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_TOKEN`
- `SPANNER_INSTANCE_ID`
- `EVIDENCE_BUCKET`
- `VERTEX_AI_AYAOPS_URL_DATASTORE`
- `VERTEX_AI_REPO_DATASTORE_PATH`
- `VERTEX_SEARCH_DATASTORE_ID`
- `DISCOVERY_GCS_BUCKET`
- `GEMINI_CHAT_MODEL`
- `GEMINI_REPO_MODEL`

The Cloud Run service account needs `roles/secretmanager.secretAccessor` for those secrets, plus the existing least-privilege access for Spanner, Vertex AI, Discovery Engine, and Cloud Storage.

## Health Check

```bash
curl https://SERVICE_URL/api/health
```

Expected shape:

```json
{
  "status": "ok",
  "runtime": "cloud-run",
  "googleProject": "workflowos-a0fbf"
}
```

## Notes

- Vercel is deprecated for this repository.
- Long-running repo indexing should move to Cloud Tasks rather than synchronous request work.
- Cloud Run supports HTTP streaming, but long-lived work should still be queued where possible.
