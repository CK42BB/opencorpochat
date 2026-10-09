# OpenCorpoChat documentation

Pick the section that matches what you're trying to do.

## Evaluate

| Doc                                                                  | What's in it                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Features](features.md)                                              | The top 5 features with screenshots, the full feature matrix, and what we skip. |
| [Getting started](getting-started.md#a-try-it-locally-in-60-seconds) | Run a demo company locally in about a minute.                                   |
| [FAQ](faq.md)                                                        | Common questions about licensing, scale, privacy and migration.                 |
| [Product requirements (PRD)](PRD.md)                                 | Goals, scope, principles and roadmap.                                           |

## Install & operate

| Doc                                   | What's in it                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md) | Four install paths, from a one-line demo to production, plus a first-day checklist.              |
| [Admin guide](admin-guide.md)         | Every setting: HTTPS, SSO, email, calls (STUN/TURN/LiveKit), backups, upgrades, troubleshooting. |
| [Export format](export-format.md)     | The NDJSON organization export, for compliance and migrations.                                   |

## Use

| Doc                         | What's in it                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| [User guide](user-guide.md) | Everyday use: channels, threads, mentions, formatting, search, notifications, calls and shortcuts. |

## Integrate

| Doc                                      | What's in it                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| [Integrations cookbook](integrations.md) | CI notifications, alerts, bots, slash commands, scripts, and generated API clients. |
| [API overview](api/README.md)            | Authentication, tokens, scopes, errors, webhooks and rate limits.                   |
| [Realtime API](api/realtime.md)          | WebSocket events and frames.                                                        |
| `/api/v1/openapi.json`                   | The machine-readable REST reference, served by every running instance.              |

## Fork & contribute

| Doc                                   | What's in it                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Development guide](development.md)   | Dev setup, a monorepo tour, how a request flows, migrations, tests, and building a feature end to end. |
| [Architecture](architecture.md)       | The big picture and why it's designed this way.                                                        |
| [Forking & rebranding](forking.md)    | Your own name, colors and logo, publishing images, staying in sync, and AGPL obligations.              |
| [Translating](translating.md)         | Adding a language.                                                                                     |
| [Architecture decision records](adr/) | Why we chose TypeScript, SQLite-first, AGPL, and WebRTC mesh.                                          |
| [Contributing](../CONTRIBUTING.md)    | Workflow, coding standards, DCO sign-off and IP guardrails.                                            |
