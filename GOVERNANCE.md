# Governance

OpenCorpoChat is a community project. It exists to give small organizations team chat they truly own, and its governance is meant to keep it that way: open, vendor-neutral, and sustainable.

## Roles

**Users** run OpenCorpoChat. You help the project by filing bugs, answering questions, and sharing what works.

**Contributors** are anyone who has had a contribution merged (code, docs, translations, design, triage). Every contributor signs off their commits under the [Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin-dco).

**Maintainers** have merge rights. They:

- review and merge pull requests
- triage issues and guide the roadmap
- uphold the [Code of Conduct](CODE_OF_CONDUCT.md) and the IP guardrails in [CONTRIBUTING.md](CONTRIBUTING.md#ip-guardrails-reviewer-checklist)
- handle security reports according to [SECURITY.md](SECURITY.md)

Maintainers are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS) (currently [@CK42BB](https://github.com/CK42BB)).

Some maintainers also act as **module owners** for an area of the codebase (for example `apps/server/src/modules/calls/`). Their review is required for significant changes there.

## Decision making

1. **Lazy consensus.** Most decisions happen in pull requests and issues. If no maintainer objects within a reasonable time (normally 72 hours for non-trivial changes), the change can proceed.
2. **Architecture Decision Records (ADRs).** Significant technical decisions are proposed as a PR that adds a file to [`docs/adr/`](docs/adr/). Examples include new runtime dependencies, data-model changes, new external services, and changes to the public API or realtime protocol. An ADR is accepted once two maintainers approve it and no maintainer has an unresolved objection.
3. **Voting.** If consensus can't be reached, maintainers vote. A simple majority of active maintainers decides. Changes to this governance document, the license, or the IP guardrails need a two-thirds majority.

## Becoming a maintainer

Any maintainer can nominate a contributor who has shown sustained, high-quality involvement over at least three months, typically through code reviews, merged PRs, triage, or docs. A nomination succeeds when a majority of maintainers approve and none object.

Maintainers who have been inactive for six months may be moved to emeritus status, with thanks. They can return at any time by asking.

## Project principles

These come from the [PRD](docs/PRD.md) and guide every decision:

- **No paid tier.** Every feature lives in the open-source edition. We don't accept features designed to be withheld.
- **Easy to run.** One container, optional dependencies, secure defaults.
- **Easy to fork.** Boring tech, clear module boundaries, docs for generalists.
- **Legally clean.** An original implementation, open standards, and no use of third-party trademarks or assets.

## License and trademark

The code is licensed under [AGPL-3.0-only](LICENSE). Contributions are accepted under the same license through DCO sign-off. We don't use a CLA, so no single entity can relicense contributors' work.

The project name and logo belong to the community. Forks are welcome, but please give yours a distinct name if it's materially different, so users aren't confused.

## Code of Conduct

All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
