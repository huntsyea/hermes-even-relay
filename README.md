# hermes-even-relay

Production relay service for Hermes Even Hub bridge connections.

This repo is the public HTTPS/WSS relay origin for the Hermes G2 bridge. It
pairs a locally running Hermes plugin with the Even Hub glasses app without
putting per-user LAN, Tailscale, or root bridge-token values into a published
Even Hub package.

## Decisions

- Runtime: Cloudflare Workers + Durable Objects.
- Language: TypeScript.
- Public origin: whitelist the HTTPS origin in the Even Hub app manifest and
  connect to the corresponding WSS endpoint at runtime.
- Auth: short-lived pairing codes mint device-scoped relay credentials.
- Trust boundary: `EVENHUB_BRIDGE_TOKEN` remains local to Hermes and is never
  sent to this relay or to the production glasses app.
- Relay behavior: forward authenticated JSON frames and binary PCM between the
  gateway and device sockets without storing content or understanding Hermes
  agent semantics.

## Local commands

```bash
npm install
npm run typecheck
npm run test
npm run dev
```

## Planned surface

| Endpoint | Client | Purpose |
|---|---|---|
| `GET /healthz` | ops | Health check. |
| `POST /v1/pairing-codes` | Hermes plugin | Create a short-lived pairing code for a gateway session. |
| `POST /v1/pairing-codes/claim` | glasses app | Exchange code for a device credential. |
| `WS /v1/gateway` | Hermes plugin | Authenticated outbound gateway socket. |
| `WS /v1/device` | glasses app | Authenticated device socket. |
| `POST /v1/devices/{id}/revoke` | Hermes plugin | Revoke one device credential. |

## Security baseline

- TLS only in production.
- Hash stored credentials; never store bearer tokens in plaintext.
- Redact authorization headers, pairing codes, credentials, frame bodies, and
  PCM payloads from logs.
- Enforce frame-size, PCM byte-budget, idle-timeout, and per-IP rate limits
  before forwarding.
- Do not persist transcript text, assistant text, or PCM payloads.
