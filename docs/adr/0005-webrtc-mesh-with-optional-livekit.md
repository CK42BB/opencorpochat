# 5. WebRTC mesh calls built in, LiveKit SFU optional

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Voice and video calls with screen sharing are table stakes (PRD §6.7). A media server (SFU) scales well but is another service to deploy. Sending users to an external meeting tool makes calls feel bolted on, and adds a dependency anyway.

## Decision

- **Signaling** runs over the existing WebSocket (`call.join/leave/offer/answer/ice`). The server relays messages and tracks participants.
- **Mesh mode is the default:** browsers connect directly to each other. It suits 1:1 calls and small huddles of up to about 6 participants, and needs no extra service.
- **NAT traversal:** the admin configures STUN/TURN. The server gives clients short-lived TURN credentials using the standard TURN REST API HMAC scheme with a shared secret, which is compatible with coturn. No public third-party STUN server is used unless the admin configures one, which keeps outbound calls opt-in.
- **SFU mode:** when `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are set, the server issues LiveKit access tokens, and larger calls go through LiveKit (Apache-2.0). LiveKit is open source and self-hostable.
- The client hides both modes behind a `CallTransport` interface, so the call UI is the same either way.

## Consequences

- Calls work out of the box for small teams, using only open standards (W3C/IETF WebRTC) and the codecs browsers already have.
- In mesh mode, each participant uploads one stream per other participant, which limits practical size to about 6. Larger calls need LiveKit.
- Without TURN, some calls fail on restrictive networks. The admin guide treats TURN as required for production and includes a coturn config.
- Recording requires LiveKit egress, which is deferred (P2).
