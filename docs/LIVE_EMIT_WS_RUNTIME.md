# Live Emit WebSocket Runtime

Dedicated runtime for primary WebSocket transport (`WS-first`) with parity to the SSE contract.

## Run locally

```bash
npm run live-emit:ws
```

Default endpoint:

- `ws://127.0.0.1:${PORT:-8787}/ws/live-emit`
- `http://127.0.0.1:${PORT:-8787}/healthz`
- `http://127.0.0.1:${PORT:-8787}/version`

## Deploy (Cloud Run)

```bash
APP_BASE_URL="https://your-app.example.com" \
GOOGLE_CLOUD_PROJECT="your-project-id" \
npm run live-emit:ws:deploy
```

Optional deploy env:

- `LIVE_EMIT_WS_SERVICE_NAME` (default `thelab-live-emit-ws`)
- `LIVE_EMIT_WS_REGION` (default `us-central1`)
- `LIVE_EMIT_WS_ALLOWED_ORIGINS`
- `LIVE_EMIT_SESSION_VALIDATE_URL`
- `LIVE_EMIT_SESSION_VALIDATE_AUTH_SECRET` (Secret Manager name)
- `LIVE_EMIT_SESSION_VALIDATE_AUTH` (inline fallback)
- `LIVE_EMIT_WS_MIN_INSTANCES`
- `LIVE_EMIT_WS_MAX_INSTANCES`

## One-command smoke

```bash
APP_BASE_URL="https://your-app.example.com" \
WS_URL="wss://your-ws-service.example.com/ws/live-emit" \
npm run smoke:live-emit-ws
```

Smoke validates:

1. session bootstrap
2. session validate endpoint
3. websocket handshake
4. first stream packet
5. expired-session rejection (`VETO_SIGNAL` + close `4401`)

## Required contract

Client sends:

```json
{
  "type": "START_STREAM",
  "payload": {
    "prompt": "string",
    "mode": "sports|worldcup|healthcare|ayaops|code",
    "thinkingLevel": "LOW|MEDIUM|HIGH",
    "includeThoughts": false,
    "sessionId": "live_...",
    "sessionToken": "uuid",
    "lastAckSequence": 0
  }
}
```

Server streams `LiveEmitPacket` rows with the same schema as SSE:

- `id`
- `session_id`
- `sequence`
- `type`
- `payload`

## Session validation

The WS runtime validates each `sessionId/sessionToken` pair using:

- `LIVE_EMIT_SESSION_VALIDATE_URL` (default: `http://127.0.0.1:3000/api/live-emit/session/validate`)
- optional `LIVE_EMIT_SESSION_VALIDATE_AUTH` header

Invalid/expired sessions return a `VETO_SIGNAL` and close the socket.

## Optional env

- `PORT` (default `8787`)
- `LIVE_EMIT_WS_ALLOWED_ORIGINS` (comma-separated)
- `LIVE_EMIT_SESSION_VALIDATE_URL`
- `LIVE_EMIT_SESSION_VALIDATE_AUTH`
- `GEMINI_LIVE_EMIT_MODEL`
- `GOOGLE_CLOUD_PROJECT`

## Safety/ops behavior

- heartbeat ping/pong
- immediate terminate on stale sockets
- monotonic packet sequencing enforced by stream manager/client merge
- abort active stream on disconnect
- runtime close timeout protection
- structured logs with correlation IDs:
  - `connection_id`
  - `request_id`
  - `session_id`
- deploy metadata in logs:
  - `LIVE_EMIT_WS_VERSION`
  - `LIVE_EMIT_WS_DEPLOYED_AT`
