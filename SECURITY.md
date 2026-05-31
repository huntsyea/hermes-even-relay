# Security Policy

## Reporting a vulnerability

Report security issues privately through GitHub Security Advisories once the
repository is published.

## Threat model

This relay connects the production Even Hub glasses app to a user's local Hermes
bridge through outbound authenticated WSS connections. It must not become a
second root credential boundary.

- `EVENHUB_BRIDGE_TOKEN` stays local to the Hermes plugin.
- Relay credentials are scoped to one gateway or one paired device.
- Pairing codes are short-lived and single-use.
- The relay forwards frames but does not store prompt, transcript, assistant, or
  PCM content.
- Logs must redact credentials and payload bodies.
