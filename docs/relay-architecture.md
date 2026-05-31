# Production relay architecture

[huntsyea/hermes-evenhub-bridge#10](https://github.com/huntsyea/hermes-evenhub-bridge/issues/10)
tracks the production-safe networking path for the Hermes G2 bridge. The current
direct `ws://` LAN/Tailscale flow remains useful for development and trusted
local installs, but it is not suitable for one published Even Hub app.

## Confirmed Even Hub whitelist facts

The current Even Hub docs establish these production constraints:

- Even Hub apps make network requests from the phone WebView with `fetch`,
  `XMLHttpRequest`, or WebSockets.
- Every outbound destination must pass the Even-side `app.json` `network`
  whitelist before it reaches the network.
- The whitelist is one entry per full origin, for example
  `https://api.example.com`.
- Bare hostnames and wildcard entries are not supported.
- HTTPS is required in production; plain `http://` is only for local development.
- Every whitelisted domain must actually be used, and app review flags unused
  entries.
- The whitelist is not a CORS bypass. HTTP endpoints still need normal browser
  CORS responses, including preflight handling when custom headers or JSON
  requests are used.

Sources:

- https://hub.evenrealities.com/docs/guides/networking
- https://hub.evenrealities.com/docs/reference/packaging
- https://hub.evenrealities.com/docs/reference/app-submission

Local CLI validation is weaker than the production rule. On 2026-05-31,
`evenhub pack` from `@evenrealities/evenhub-cli` `^0.1.13` accepted all of these
whitelist strings: `ws://relay.example.com`, `wss://relay.example.com`,
`https://relay.example.com`, `http://relay.example.com`, `relay.example.com`,
and `https://*.example.com`. That proves the packer does not enforce the
production origin rules. It does not prove those entries pass device enforcement
or app review.

## Whitelist decision

The production app should whitelist the relay's HTTPS origin:

```json
{
  "name": "network",
  "desc": "Connects to the user's Hermes bridge relay.",
  "whitelist": ["https://relay.example.com"]
}
```

The glasses app should connect to the corresponding WebSocket URL,
`wss://relay.example.com/...`. This follows the docs' production HTTPS-origin
guidance while using the normal WebSocket scheme at runtime.

Before submission, verify on device whether Even's whitelist matcher accepts
`wss://relay.example.com` when the manifest contains `https://relay.example.com`.
If it does not, test a manifest that contains `wss://relay.example.com` and
document the exception. Do not rely on `evenhub pack` for this because it accepts
strings the docs explicitly reject.

## Repository split

This work spans three repositories:

| Repository | Responsibility |
|---|---|
| [huntsyea/hermes-evenhub-bridge](https://github.com/huntsyea/hermes-evenhub-bridge) | Hermes plugin. Owns direct local WebSocket transport, future outbound relay client, local root token handling, dashboard pairing/status, and protocol documentation. |
| [huntsyea/hermes-even-hub-app](https://github.com/huntsyea/hermes-even-hub-app) | Even Hub glasses app. Owns `app.json`, production relay origin, first-run pairing UX, device credential storage, and the WebSocket client. |
| [huntsyea/hermes-even-relay](https://github.com/huntsyea/hermes-even-relay) | Public HTTPS/WSS relay origin. Owns pairing-code exchange, relay-side credentials, connection routing, rate limits, and deployment. |

The relay service lives in its own repository because its deployment,
operations, secrets, rate limits, abuse controls, and uptime are separate from
both the Hermes plugin and the glasses bundle.

## Auth model

Use a short-lived pairing code to mint device-scoped relay credentials. Do not
send `EVENHUB_BRIDGE_TOKEN` to the relay or to the production glasses app.

Credential classes:

| Credential | Holder | Scope | Persistence |
|---|---|---|---|
| `EVENHUB_BRIDGE_TOKEN` | Local Hermes machine only | Root credential for direct local bridge auth | `~/.hermes/.env` |
| Relay gateway credential | Hermes plugin | Authenticates one Hermes bridge instance to the relay | Hermes state file or env |
| Relay device credential | Glasses app | Authenticates one paired glasses app install to the relay | Even Hub app local storage |
| Pairing code | User-visible temporary code | One-time exchange between glasses app and local Hermes | Short TTL, never persisted |

Pairing flow:

1. Hermes plugin opens an outbound TLS WebSocket to the relay using its relay
   gateway credential. If no credential exists, the plugin creates a pairing
   request and displays a short code in the dashboard.
2. The glasses app connects to the relay's production WSS endpoint and prompts
   for the pairing code on first run.
3. The relay validates the code, binds the device to the waiting gateway
   session, and mints a device credential.
4. The glasses app stores only the device credential. The local Hermes root
   token remains local.
5. Future reconnects use the stored device credential. Re-pairing revokes or
   replaces the old device credential.

Session auth:

- Gateway connection: authenticate with a relay gateway credential, then bind to
  a relay session id.
- Device connection: authenticate with a relay device credential, then bind to
  the paired gateway session.
- Relay forwarding: after both sides authenticate, forward existing JSON frames
  and binary PCM between the two sockets without interpreting Hermes semantics.

## Relay service minimum surface

Start with a small service. Do not add account systems, multi-tenant dashboards,
or message persistence until they are required.

| Field | Decision |
|---|---|
| GitHub repo | [huntsyea/hermes-even-relay](https://github.com/huntsyea/hermes-even-relay) |
| Runtime | Cloudflare Workers + Durable Objects |
| Language | TypeScript |
| Durable object model | One object per relay session, pairing a gateway socket with one or more device sockets. |
| Storage | Durable Object storage for hashed credentials, device records, pairing-code metadata, and revocation state. |
| Local dev | Wrangler dev server with unit tests for pairing, auth, and forwarding. |

Cloudflare Durable Objects fit the relay because they can serve WebSockets,
coordinate multiple clients in one object, persist per-object state, and
hibernate idle WebSocket connections. If deployment later needs to move off
Cloudflare, the protocol and credential model should remain provider-neutral.

Suggested endpoints:

| Endpoint | Client | Purpose |
|---|---|---|
| `GET /healthz` | ops | Health check. |
| `POST /v1/pairing-codes` | Hermes plugin | Create a short-lived pairing code for a gateway session. |
| `POST /v1/pairing-codes/claim` | glasses app | Exchange code for a device credential. |
| `WS /v1/gateway` | Hermes plugin | Authenticated outbound gateway socket. |
| `WS /v1/device` | glasses app | Authenticated device socket. |
| `POST /v1/devices/{id}/revoke` | Hermes plugin | Revoke one device credential. |

Security requirements:

- TLS only; no plaintext production transport.
- Hash stored credentials; never store bearer tokens in plaintext.
- Redact authorization headers, pairing codes, credentials, JSON frame bodies,
  and PCM payloads from logs.
- Enforce maximum frame size, PCM byte budget, idle timeout, and per-IP rate
  limits before forwarding.
- Keep the relay content-blind: no transcript storage, no assistant text
  storage, no PCM storage.
- Support credential rotation and device revocation from the Hermes side.
- Treat pairing codes as single-use with a short TTL.

## Device verification checklist

These checks require Even Hub device behavior; simulator and `evenhub pack` are
not enough.

1. Build an app with `app.json` whitelist `["https://relay.example.com"]`.
2. Connect at runtime to `wss://relay.example.com/v1/device`.
3. Confirm from relay logs that the device connection reaches the relay.
4. If blocked before network traffic, repeat with
   `["wss://relay.example.com"]`.
5. Confirm any HTTP pairing endpoint passes CORS and preflight from the real
   WebView.
6. Submit/review checklist: every whitelisted origin is used, HTTPS/WSS only,
   no unused network permission entries.

## Next implementation steps

1. Implement relay credentials, pairing code storage, and revocation.
2. Add bridge configuration for relay transport separately from direct
   LAN/Tailscale address resolution.
3. Add glasses app production mode: stable relay URL, pairing-code UX, and
   device credential persistence.
4. Run the device whitelist verification before claiming the production path is
   complete.
