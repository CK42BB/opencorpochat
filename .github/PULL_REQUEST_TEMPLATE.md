## Summary

<!-- What does this PR change, and why? Link the issue: "Closes #123". -->

## How to test

<!-- Steps a reviewer can follow. Include screenshots for UI changes. -->

## Checklist

- [ ] Tests added/updated and `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] Works on both SQLite and PostgreSQL (if it touches the database)
- [ ] UI changes are keyboard-accessible, screen-reader-labelled, and use i18n strings
- [ ] Docs updated (admin guide / API / ADR) where relevant
- [ ] `CHANGELOG.md` updated under **Unreleased** for user-facing changes

## IP & licensing

- [ ] All commits are signed off (`git commit -s`), certifying the [DCO](https://developercertificate.org/)
- [ ] This is original work, or third-party code under an AGPL-compatible license with attribution added to `NOTICE`
- [ ] No proprietary code, assets, trademarks, or reverse-engineered protocols
- [ ] New dependencies are justified below and `pnpm licenses:check` passes
- [ ] New source files have an `SPDX-License-Identifier: AGPL-3.0-only` header

<!-- New dependencies and why: -->
