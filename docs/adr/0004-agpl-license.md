# 4. License under AGPL-3.0-only

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The project exists to free small organizations from rising team-chat costs. A permissive license (MIT/Apache-2.0) would let a vendor take the code, host it as a closed SaaS product, and recreate the lock-in we're trying to remove. Under the GPL alone, network services aren't required to share their source.

## Decision

- License the project under **GNU AGPL-3.0-only**.
- Accept contributions via **Developer Certificate of Origin** sign-off, with **no CLA**, so no single party can relicense the code.
- Comply with AGPL §13 in the product itself: the About dialog shows a "Source code" link, configurable through `OCPC_SOURCE_URL` so forks can point it at their modified source.
- Allow only dependencies under AGPL-compatible licenses, enforced in CI by `scripts/check-licenses.mjs`.

## Consequences

- Organizations can use, modify and self-host OpenCorpoChat freely. Internal use carries no obligation to publish changes unless users interact with a *modified* version over a network, in which case those users must be offered its source.
- Anyone offering a modified hosted version must share their changes, which keeps improvements flowing back to the community.
- Some companies have policies against AGPL software. We accept that trade-off.
- Integrations (bots, webhooks) talk to OpenCorpoChat over its network API and are separate works. They can be under any license.
