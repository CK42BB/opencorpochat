# 1. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

OpenCorpoChat is meant to be forked and extended by many small organizations. Contributors join and leave over time, and forkers need to understand *why* the code is the way it is. Without that, they may undo decisions without knowing what problems those decisions solved.

## Decision

We record significant architectural decisions as Architecture Decision Records (ADRs) in `docs/adr/`. Each one is a short Markdown file with the sections **Context → Decision → Consequences**, numbered sequentially.

An ADR is required for:

- new runtime dependencies that are significant or hard to remove
- data-model changes
- new external services
- changes to the public REST API or the realtime protocol
- changes to the security model

ADRs are proposed in a PR with status *Proposed* and accepted according to [GOVERNANCE.md](../../GOVERNANCE.md). Accepted ADRs are never edited, only superseded by a new ADR.

## Consequences

- Decisions and their reasoning become discoverable alongside the code.
- Proposing an ADR adds a little process overhead to large changes. That's intentional.
