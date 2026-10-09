# Forking & rebranding

OpenCorpoChat is meant to be forked. You might run it for your company with your own name and colors, sell hosting or support to clients, or take it in a new direction. This page shows exactly what to change and what the license asks of you.

> This page explains the license in plain language. It isn't legal advice; the [LICENSE](../LICENSE) is what counts.

## 1. Fork and keep in sync with upstream

```sh
# On GitHub: Fork → your-org/yourchat
git clone https://github.com/your-org/yourchat.git
cd yourchat
git remote add upstream https://github.com/CK42BB/opencorpochat.git

# Later, pull in upstream improvements:
git fetch upstream
git merge upstream/main        # or: git rebase upstream/main
```

Tips for painless merges:

- Keep branding changes in the few files listed below.
- Put new features in new folders: `apps/server/src/modules/<yours>/` and `apps/web/src/<yours>/`.
- Add database changes as new migrations (`0100_yourfeature.ts`) instead of editing existing ones.
- Consider sending generic improvements upstream. Then you don't have to maintain them yourself.

## 2. Name, colors and logo

| What                                          | Where                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Colors** (light theme)                      | `:root { --brand, --brand-strong, --brand-soft, --sidebar-bg, … }` at the top of `apps/web/src/styles/app.css`                                              |
| **Colors** (dark theme)                       | `:root[data-theme='dark'] { … }` in the same file                                                                                                           |
| **Fonts, radius, density**                    | `--font`, `--radius*`, `--avatar`, `--sidebar-w` in the same file                                                                                           |
| **Logo / app icon**                           | Replace `apps/web/public/icon.svg`, then regenerate the PNG icons with `node scripts/gen-icons.mjs` (or drop in your own `icon-192.png` and `icon-512.png`) |
| **App name in the browser and installed app** | `<title>` and `theme-color` in `apps/web/index.html`; `name`, `short_name` and `theme_color` in `apps/web/public/manifest.webmanifest`                      |
| **Default organization name**                 | The setup wizard asks for it. The fallback is `DEFAULT_SETTINGS.name` in `apps/server/src/modules/admin/settings.ts`                                        |
| **"Powered by" and "About" text**             | `apps/web/src/pages/auth.tsx` (`AuthCard`) and `AboutModal` in `apps/web/src/components/Sidebar.tsx`                                                        |
| **Email sender name**                         | `SMTP_FROM` environment variable                                                                                                                            |

Components only reference CSS variables, so for most rebrands changing the tokens is enough.

## 3. Your source link (AGPL §13)

OpenCorpoChat is licensed **AGPL-3.0**. If you **modify** it and let people use it **over a network**, such as your employees or customers, you must offer those users the **source code of your modified version**.

The app already supports this. Set:

```sh
OCPC_SOURCE_URL=https://github.com/your-org/yourchat
```

The link appears in **About** (organization menu) and on the sign-in page. Make sure it points to the source of the version you actually run, including your changes. A public repository or tag is the easiest way.

## 4. What you can and can't do (plain language)

| You can                                                          | You must                                                                   | You can't                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Use it commercially, including selling hosting, setup or support | Keep the license and copyright notices (`LICENSE`, `NOTICE`, SPDX headers) | Make it proprietary or closed-source                             |
| Modify it and run it for anyone                                  | Offer your modified source to the users of your instance (§3)              | Remove the obligation for your downstream users                  |
| Rebrand it with your own name                                    | License your modifications under AGPL-3.0 too                              | Use the upstream name or marks in a way that implies endorsement |
| Keep private changes that nobody else uses over a network        | Note significant changes (git history counts)                              |                                                                  |

Running **unmodified** OpenCorpoChat needs nothing extra; the default `OCPC_SOURCE_URL` already points upstream.

## 5. Trademarks and naming

Choose your own product name, and don't suggest you are the upstream project or affiliated with it. "Based on OpenCorpoChat" is fine. Other vendors' trademarks may only be used to describe compatibility, for example "imports Slack-format exports", never in your product name, logo or marketing in a way that implies affiliation.

## 6. Translations

See [translating.md](translating.md). Add `apps/web/src/locales/<lang>.json` and it's picked up automatically from the browser's language.

## 7. Build and publish your own Docker image

The repository ships `.github/workflows/release.yml`. Pushing a tag builds a multi-architecture image, publishes it to the GitHub Container Registry of **your** fork, generates an SBOM, signs the image with cosign, and creates a GitHub release.

```sh
git tag v1.0.0-yourchat.1
git push origin v1.0.0-yourchat.1
# → ghcr.io/your-org/yourchat:1.0.0-yourchat.1
```

To build locally:

```sh
docker build -f deploy/Dockerfile -t yourchat:dev .
```

Then update the `image:` lines in `deploy/compose/*.yml`, and the `ghcr.io/…` references in the docs if you publish your own guides.

## 8. Extending without forking too far

- **Bots and webhooks** cover most custom workflows without changing any code. See the [integrations cookbook](integrations.md).
- **New server features:** add a module folder, register its routes in `apps/server/src/app.ts`, and they get auth, validation and OpenAPI docs automatically. See the [development guide](development.md#recipe-add-a-feature-end-to-end).
- **Different storage or search:** `apps/server/src/modules/files/storage.ts` (the `Storage` interface) and `apps/server/src/modules/search/routes.ts` are the extension points.
