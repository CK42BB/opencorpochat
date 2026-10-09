# Contributing to OpenCorpoChat

Thank you for helping build team chat that organizations truly own! This guide covers how to set up a dev environment, the project's conventions, and the legal requirements every contribution has to meet.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs** and **suggest features** with the [issue forms](https://github.com/opencorpochat/opencorpochat/issues/new/choose).
- **Improve docs.** The admin guide is written for non-experts, so if something confused you, it'll confuse others.
- **Translate** the UI. All strings live in `apps/web/src/i18n/`.
- **Write code.** Look for issues labelled `good first issue` or `help wanted`.
- **Review pull requests** and help triage issues.

For anything large (a new feature, a new dependency, or a data-model change), please open an issue or discussion first so we can agree on the approach before you invest time.

## Development setup

### Prerequisites

- **Node.js ≥ 22.12** (see `.nvmrc`; `nvm use` picks it up)
- **pnpm 10** (`corepack enable` gives you the version pinned in `package.json`)
- Git

No database server is needed. Development uses SQLite in `./data/`.

### Run it

```bash
git clone https://github.com/opencorpochat/opencorpochat.git
cd opencorpochat
pnpm install
pnpm dev
```

- Web client: <http://localhost:5173>. Vite proxies `/api` (including the WebSocket at `/api/v1/ws`) to the server.
- API server: <http://localhost:8080>

On first visit you'll see the **setup wizard**, which creates the owner account. To start over, stop the server and delete `./data/`.

### Common commands

| Command               | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `pnpm dev`            | Run server and web client with hot reload            |
| `pnpm test`           | Run all unit/integration tests (Vitest)              |
| `pnpm typecheck`      | Type-check every package                             |
| `pnpm lint`           | ESLint                                               |
| `pnpm format`         | Format with Prettier (`pnpm format:check` to verify) |
| `pnpm build`          | Production build (shared → web → server)             |
| `pnpm licenses:check` | Verify all dependency licenses are AGPL-compatible   |

### Testing against PostgreSQL

```bash
docker run -d --name ocpc-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ocpc -p 5432:5432 postgres:17
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ocpc pnpm --filter @ocpc/server test
```

CI runs the server test suite against both SQLite and PostgreSQL.

## Repository layout

```
opencorpochat/
├── apps/
│   ├── server/          # Fastify API, WebSocket gateway, jobs, CLI (ocpc)
│   └── web/             # React SPA / PWA
├── packages/
│   └── shared/          # Zod schemas, event types, permission constants, utils
├── deploy/              # Dockerfile, compose files, Caddy/nginx/coturn/LiveKit/systemd examples
├── docs/                # PRD, architecture, admin guide, ADRs
├── scripts/             # Repo tooling (license check, …)
└── .github/             # CI, issue templates, dependabot
```

### Server modules

Server features live in `apps/server/src/modules/<domain>/`, for example `auth`, `users`, `channels`, `messages`, `files`, `search`, `calls`, `integrations`, `admin`, `notifications`. Each module owns its:

- **routes** (HTTP handlers, validated with shared Zod schemas)
- **service** (business logic, the only thing other modules may call)
- **queries** (its own tables, written with Kysely)

**Rules of thumb:**

- Never query another module's tables directly. Call its service instead.
- Every route checks permissions through the central `authz` module. Never write ad-hoc role checks.
- The web client uses only the public REST and WebSocket API. If the UI needs something, add it to the API so bots can use it too.
- Write SQL that works on **both SQLite and PostgreSQL**. Where they differ (for example, full-text search), put the difference behind an interface.

## Coding standards

- **TypeScript strict mode** everywhere. Avoid `any`, and leave a comment explaining why if you can't.
- **Formatting** is Prettier's job. Don't argue with it.
- **Tests:** new behaviour needs tests. Permission logic in `authz` needs 100% coverage.
- **Accessibility:** UI changes must be keyboard-operable and labelled for screen readers (WCAG 2.2 AA).
- **i18n:** no hard-coded user-facing strings in components. Use the translation helper.
- **Privacy:** don't add outbound network calls that aren't opt-in by an admin.
- **SPDX headers:** every source file starts with:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-only
  ```

  (Use the comment syntax appropriate to the file type, e.g. `/* … */` in CSS, `#` in shell/YAML.)

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(messages): add scheduled messages
fix(calls): reconnect ICE after network change
docs(admin-guide): explain TURN on port 443
```

Common types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. Breaking changes add `!` after the type (`feat(api)!: …`) and a `BREAKING CHANGE:` footer.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. Signing off certifies that you wrote the change, or otherwise have the right to submit it under the project's license, as described in the [Developer Certificate of Origin 1.1](https://developercertificate.org/).

Sign off by committing with `-s`:

```bash
git commit -s -m "feat(search): support has:link filter"
```

This adds a trailer using your Git name and email:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Use your real name (or the name you're publicly known by) and an email you can be reached at. A CI check rejects pull requests containing commits without a sign-off. To fix those after the fact:

```bash
git rebase --signoff main
git push --force-with-lease
```

We don't use a Contributor License Agreement. You keep your copyright, and your contribution is licensed under AGPL-3.0-only like the rest of the project.

## IP guardrails (reviewer checklist)

OpenCorpoChat must stay legally clean so any organization can adopt it without risk. Reviewers check every PR against this list, and authors should self-check before requesting review.

- [ ] **Original work.** No code copied from proprietary products. Code from other open-source projects is allowed only if it's under an AGPL-compatible license (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0, AGPL-3.0). It must keep its copyright notice and be recorded in `NOTICE`.
- [ ] **No reverse engineering.** Nothing derived from decompiling or inspecting proprietary clients, or from private/undocumented APIs. Interoperability (for example, importers) uses only publicly documented formats and open standards.
- [ ] **No third-party trademarks in branding.** Other products' names appear only descriptively (for example, "Import a Slack export archive"). They never appear in product names, feature names, icons, or anything that implies affiliation.
- [ ] **No copied visual identity.** Colors, logos, icons, illustrations, sounds, and UI copy are original or properly licensed. Icons come from Lucide (ISC). Emoji are rendered with native Unicode, so no emoji image sets are added.
- [ ] **New dependencies** have an AGPL-compatible license (`pnpm licenses:check` passes), are actively maintained, and are justified in the PR description. Significant ones need an [ADR](docs/adr/).
- [ ] **Assets** (images, fonts, sounds) include their source and license in the PR, and are added to `REUSE.toml` if they aren't covered already.
- [ ] **All commits are signed off** (DCO).
- [ ] **SPDX header** is present on new source files.

If you're unsure whether something is OK, ask in the PR. We'd much rather discuss it than have to remove it later.

## Architecture Decision Records

Significant decisions are recorded in [`docs/adr/`](docs/adr/) using a lightweight format: Context → Decision → Consequences. To propose one:

1. Copy the format of an existing ADR into `docs/adr/NNNN-short-title.md` with the next number.
2. Set its status to **Proposed** and open a PR.
3. Once accepted (see [GOVERNANCE.md](GOVERNANCE.md)), change the status to **Accepted**.

ADRs aren't edited after acceptance. To change a decision, write a new ADR that supersedes the old one.

## Pull request process

1. Fork the repo and create a branch off `main`, such as `feat/scheduled-messages`.
2. Make your change with tests and docs.
3. Run `pnpm lint && pnpm typecheck && pnpm test` locally.
4. Open a PR and fill in the template. Link the related issue.
5. A maintainer reviews it. Expect some back-and-forth; it's normal and welcome.
6. Once CI is green and the PR is approved, a maintainer squash-merges it.

User-facing changes should add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).

## Reporting security issues

Please **don't** open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).
