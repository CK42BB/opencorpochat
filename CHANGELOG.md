# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Product Requirements Document (`docs/PRD.md`) and architecture decision records.
- Monorepo foundation: TypeScript server (Fastify), React web client, shared schema package.
- First-run setup wizard, email/password accounts, invites, roles (owner, admin, member, guest).
- Public and private channels, direct and group messages, threads, reactions, mentions, edits and deletes, pins, saved items, unread tracking, typing indicators and presence.
- File uploads to local disk or S3-compatible storage.
- Full-text message search with filters, and a quick switcher.
- In-app and Web Push notifications, custom status and Do Not Disturb.
- Voice/video calls and screen sharing over WebRTC, with a built-in STUN server (UDP 3478), optional TURN and LiveKit SFU support, a call diagnostics page and an `ocpcCallDebug()` console helper.
- REST API, realtime WebSocket API, bot accounts, API tokens, incoming/outgoing webhooks and slash commands.
- OpenID Connect single sign-on and TOTP two-factor authentication.
- Admin console, audit log, retention policies, export, and an importer for Slack-format export archives.
- `ocpc` admin CLI (migrate, create-admin, reset-password, backup, restore, export, import-slack, generate-vapid).
- Docker image, Docker Compose examples (minimal and full), and nginx, Caddy, coturn, LiveKit and systemd examples.
- End-to-end tests (Playwright): setup, invites, realtime messaging, threads, unread badges, search and a two-person call.
- Open-source governance: AGPL-3.0 license, NOTICE, Code of Conduct, contributing guide with DCO, security policy, CI with license allowlist, CodeQL and OpenSSF Scorecard.

[Unreleased]: https://github.com/CK42BB/opencorpochat/commits/main
