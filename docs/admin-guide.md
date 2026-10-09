# OpenCorpoChat Admin Guide

This guide is for the person who installs and looks after OpenCorpoChat. That's often an office manager or IT generalist, not a full-time developer. If anything here is unclear, please [open an issue](https://github.com/CK42BB/opencorpochat/issues). Unclear docs are bugs.

- [1. Choose an install path](#1-choose-an-install-path)
- [2. Quick start (Docker)](#2-quick-start-docker)
- [3. Recommended production setup (Docker Compose + HTTPS)](#3-recommended-production-setup-docker-compose--https)
- [4. Full setup (Postgres, S3, TURN, LiveKit)](#4-full-setup-postgres-s3-turn-livekit)
- [5. Bare metal (no Docker)](#5-bare-metal-no-docker)
- [6. First-run setup wizard](#6-first-run-setup-wizard)
- [7. Configuration reference](#7-configuration-reference)
- [8. The `ocpc` command-line tool](#8-the-ocpc-command-line-tool)
- [9. Backups and restore](#9-backups-and-restore)
- [10. Upgrades](#10-upgrades)
- [11. Calls: STUN, TURN and LiveKit](#11-calls-stun-turn-and-livekit)
- [12. Single sign-on (OIDC)](#12-single-sign-on-oidc)
- [13. Email (SMTP)](#13-email-smtp)
- [14. Browser notifications (Web Push)](#14-browser-notifications-web-push)
- [15. File storage (S3)](#15-file-storage-s3)
- [16. Retention, export and compliance](#16-retention-export-and-compliance)
- [17. Security checklist](#security-checklist)
- [18. Troubleshooting](#troubleshooting)

---

## 1. Choose an install path

| Your situation                                           | Use                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "I just want to try it"                                  | [Quick start](#2-quick-start-docker): one `docker run` command                                    |
| Small team (up to ~100 people), one server               | [Docker Compose + HTTPS](#3-recommended-production-setup-docker-compose--https) (**recommended**) |
| Larger team, big video meetings, or you want Postgres/S3 | [Full setup](#4-full-setup-postgres-s3-turn-livekit)                                              |
| No Docker allowed                                        | [Bare metal](#5-bare-metal-no-docker)                                                             |

**Server sizing:** 1 vCPU and 1 GB RAM handles a 50-person team comfortably. For 200 people, use 2 vCPU / 2 GB RAM. Add more if you run LiveKit for large calls on the same machine. Disk space mostly depends on how many files people upload.

## 2. Quick start (Docker)

```bash
docker run -d --name ocpc -p 8080:8080 -v ocpc-data:/data \
  ghcr.io/ck42bb/opencorpochat:latest
```

Open <http://localhost:8080> and follow the [setup wizard](#6-first-run-setup-wizard).

> This is fine for evaluation. For real use, you need **HTTPS**. Browsers block notifications, calls, and installing the app on plain HTTP (except on `localhost`).

## 3. Recommended production setup (Docker Compose + HTTPS)

You need:

- a Linux server with [Docker](https://docs.docker.com/engine/install/) installed
- a domain name, for example `chat.example.com`, with a DNS **A** record pointing at the server's IP
- ports **80** and **443** open in the firewall

Then:

```bash
git clone https://github.com/CK42BB/opencorpochat.git
cd opencorpochat/deploy/compose
cp .env.example .env
nano .env            # set OCPC_DOMAIN=chat.example.com
docker compose up -d
```

Caddy gets an HTTPS certificate automatically (from Let's Encrypt). After a minute, open `https://chat.example.com`.

Your data lives in the `ocpc-data` Docker volume: the SQLite database, uploaded files, and generated secrets. **Back it up** (see [§9](#9-backups-and-restore)).

## 4. Full setup (Postgres, S3, TURN, LiveKit)

`deploy/compose/docker-compose.full.yml` adds:

| Service       | Why                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| PostgreSQL 17 | Better for large orgs and very large message histories                        |
| MinIO         | S3-compatible file storage (or point at AWS S3, Backblaze B2, Cloudflare R2…) |
| coturn        | TURN relay so calls work through strict firewalls and corporate NATs          |
| LiveKit       | SFU for meetings with more than ~6 participants                               |

Steps:

1. Create two DNS records pointing at the server: `chat.example.com` and `livekit.example.com`.
2. Open the firewall ports listed at the top of `docker-compose.full.yml`.
3. Copy and edit the configuration. **Every value marked "(full setup)" must be changed**, and you can generate secrets with `openssl rand -hex 32`:

   ```bash
   cd deploy/compose
   cp .env.example .env
   nano .env
   ```

4. If the server is behind NAT (most cloud VMs are), set `external-ip=` in `deploy/coturn/turnserver.conf` to its public IP.
5. Start everything:

   ```bash
   docker compose -f docker-compose.full.yml up -d
   ```

## 5. Bare metal (no Docker)

Requirements: Node.js ≥ 22.12, pnpm 10 (`corepack enable`), and a build toolchain (`python3 make g++`) for the SQLite driver.

```bash
sudo git clone https://github.com/CK42BB/opencorpochat.git /opt/opencorpochat
cd /opt/opencorpochat
sudo corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Then install the systemd service from `deploy/systemd/opencorpochat.service`. The comments at the top of that file have the exact commands. Put a reverse proxy in front for HTTPS. `deploy/nginx/opencorpochat.conf` is a ready-made nginx example, and Caddy works too.

## 6. First-run setup wizard

The first time anyone opens OpenCorpoChat, it shows a setup wizard that:

1. creates the **owner** account (the first super-admin), and
2. sets your organization's name and creates the default channels (for example `#general` and `#random`).

> ⚠️ Until the wizard is completed, anyone who can reach the server can claim the owner account. Finish setup right after installing, or keep the server firewalled until you do. You can also create the owner from the command line instead: `ocpc create-admin --email you@example.com --username you --password '...'`.

After that, invite people from **Admin → Invites**. You can share an invite link (optionally limited to your email domain, a maximum number of uses, and an expiry date) or send email invites if [SMTP](#13-email-smtp) is configured.

## 7. Configuration reference

OpenCorpoChat is configured with **environment variables**. In Docker Compose, put them in `.env`. With systemd, put them in `/etc/opencorpochat/env`. Organization-level settings, like the org name, invite policy, retention, and requiring 2FA, are changed in the **Admin console** inside the app.

The server checks its configuration at startup and exits with a clear message if something is wrong.

### Core

| Variable             | Default                                   | Description                                                                                                                                   |
| -------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | `8080`                                    | HTTP port                                                                                                                                     |
| `HOST`               | `0.0.0.0`                                 | Interface to listen on                                                                                                                        |
| `OCPC_PUBLIC_URL`    | —                                         | **Required in production.** The URL people use, e.g. `https://chat.example.com`. Used in links, emails, SSO redirects and push notifications. |
| `OCPC_DATA_DIR`      | `./data` (`/data` in Docker)              | Where the SQLite database, uploaded files and generated secrets are stored                                                                    |
| `DATABASE_URL`       | SQLite file `$OCPC_DATA_DIR/ocpc.db`      | Set to `postgres://user:pass@host:5432/db` to use PostgreSQL                                                                                  |
| `OCPC_SECRET`        | auto-generated                            | Secret for signing tokens. If unset, one is generated and saved in the data directory. **Keep it safe; it's included in backups.**            |
| `OCPC_SOURCE_URL`    | `https://github.com/CK42BB/opencorpochat` | "Source code" link in the About dialog. If you modify OpenCorpoChat, the AGPL requires you to point this at your modified source.             |
| `OCPC_LOG_LEVEL`     | `info`                                    | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                                                                            |
| `OCPC_MAX_UPLOAD_MB` | `100`                                     | Maximum size of a single uploaded file                                                                                                        |
| `OCPC_TRUST_PROXY`   | `false`                                   | Set `true` when behind Caddy/nginx/a load balancer so the real client IPs are logged and rate-limited                                         |

### File storage (S3-compatible)

If `S3_BUCKET` is unset, files are stored on local disk in `$OCPC_DATA_DIR/files`.

| Variable                                    | Description                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `S3_ENDPOINT`                               | Endpoint URL, e.g. `https://s3.eu-central-1.amazonaws.com` or `http://minio:9000` |
| `S3_REGION`                                 | Region, e.g. `us-east-1`                                                          |
| `S3_BUCKET`                                 | Bucket name (must already exist)                                                  |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credentials                                                                       |
| `S3_FORCE_PATH_STYLE`                       | `true` for MinIO and most non-AWS providers                                       |

### Email

| Variable    | Description                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_URL`  | e.g. `smtps://user:password@smtp.example.com:465` or `smtp://user:password@host:587` (STARTTLS). URL-encode special characters in the password. |
| `SMTP_FROM` | Sender, e.g. `"OpenCorpoChat <chat@example.com>"`                                                                                               |

### Single sign-on (OIDC)

| Variable                                | Default            | Description                                                                      |
| --------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `OIDC_ISSUER`                           | —                  | Your provider's issuer URL                                                       |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | —                  | From your provider                                                               |
| `OIDC_BUTTON_LABEL`                     | `Sign in with SSO` | Text on the login button                                                         |
| `OIDC_AUTO_CREATE`                      | `true`             | Create an account automatically the first time someone signs in                  |
| `OIDC_ALLOWED_DOMAINS`                  | —                  | Comma-separated email domains allowed to sign in, e.g. `example.com,example.org` |

### Calls

| Variable                                 | Description                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STUN_URLS`                              | Comma-separated STUN URLs, e.g. `stun:turn.example.com:3478`. If empty, browsers use the built-in STUN server. No third-party STUN server is ever used unless you configure one. |
| `OCPC_STUN_PORT`                         | UDP port of the built-in STUN server (default `3478`; `0` disables it).                                                                                                          |
| `OCPC_STUN_HOST`                         | Hostname browsers use to reach the built-in STUN server (default: host of `OCPC_PUBLIC_URL`).                                                                                    |
| `TURN_URLS`                              | Comma-separated TURN URLs, e.g. `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`                                                             |
| `TURN_SECRET`                            | Shared secret matching coturn's `static-auth-secret`. OpenCorpoChat gives each user short-lived TURN credentials.                                                                |
| `LIVEKIT_URL`                            | e.g. `wss://livekit.example.com`. When set, large calls use LiveKit.                                                                                                             |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Must match the LiveKit server's keys                                                                                                                                             |

### Web Push

| Variable                                 | Description                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Keys that identify your server to browser push services. Auto-generated and saved in the data directory if unset. |
| `VAPID_SUBJECT`                          | Contact for push services, e.g. `mailto:admin@example.com` (defaults to `OCPC_PUBLIC_URL`)                        |

## 8. The `ocpc` command-line tool

In Docker, run commands with `docker exec -it ocpc ocpc <command>`. On bare metal, use `node apps/server/dist/cli.js <command>` from the install directory.

| Command                                                 | What it does                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ocpc migrate`                                          | Apply database migrations. This also happens automatically at startup.                         |
| `ocpc create-admin --email E --username U --password P` | Create an owner/admin account (useful if you skipped the wizard or got locked out)             |
| `ocpc reset-password --email E`                         | Set a new password for a user (it prompts for or prints one)                                   |
| `ocpc backup --out FILE`                                | Write a consistent backup of the database, files and secrets                                   |
| `ocpc restore --in FILE`                                | Restore a backup into an **empty** data directory or database                                  |
| `ocpc export --out FILE`                                | Export the whole organization (messages, channels, users, files) in the documented JSON format |
| `ocpc import-slack --in export.zip`                     | Import channels, users and messages from a Slack-format workspace export archive               |
| `ocpc generate-vapid`                                   | Print a new pair of Web Push keys                                                              |
| `ocpc --version`                                        | Print the version                                                                              |

## 9. Backups and restore

**What to back up:** the database, uploaded files, and the generated secrets in the data directory. `ocpc backup` collects all three into a single file:

```bash
docker exec ocpc ocpc backup --out /data/backups/ocpc-$(date +%F).tar
docker cp ocpc:/data/backups/ocpc-$(date +%F).tar ./
```

Automate it with cron on the host. Here's an example that runs every night at 02:30 and keeps 14 days:

```cron
30 2 * * * docker exec ocpc ocpc backup --out /data/backups/ocpc-$(date +\%F).tar && find /var/lib/docker/volumes/compose_ocpc-data/_data/backups -mtime +14 -delete
```

**Copy backups off the server.** A backup on the same disk won't help if the disk dies.

If you use **Postgres** or **S3**, also back those up with their own tools (`pg_dump`, bucket versioning or replication). `ocpc backup` then only includes what lives in the data directory.

**To restore:**

```bash
docker compose down
docker volume rm compose_ocpc-data            # ⚠️ deletes current data
docker compose run --rm app ocpc restore --in /path/in/container/ocpc-2026-10-09.tar
docker compose up -d
```

Test a restore on a spare machine at least once. Until you've done that, you can't be sure the backup works.

## 10. Upgrades

1. **Back up first** ([§9](#9-backups-and-restore)).
2. Read the [CHANGELOG](../CHANGELOG.md) for anything marked **breaking**.
3. Pull and restart:

   ```bash
   docker compose pull
   docker compose up -d
   ```

Database migrations run automatically at startup inside a transaction. If one fails, the server refuses to start and leaves your data untouched.

**Rollback:** migrations only go forward. To go back to an older version, stop the server, restore the backup you took before upgrading, and start the old image tag.

**Pinning versions:** in production, consider pinning a minor version instead of `latest`, e.g. `ghcr.io/ck42bb/opencorpochat:1.2`. You'll still get patch releases, and you choose when to take minor ones.

## 11. Calls: STUN, TURN and LiveKit

OpenCorpoChat calls use **WebRTC**, which is built into browsers.

- **Small calls (up to ~6 people)** connect people's browsers directly to each other ("mesh"). The server only helps them find each other.
- **Built-in STUN:** the server answers STUN requests on **UDP 3478** by default, so most home and office networks connect without any third-party service. Open `3478/udp` in your firewall (the Docker Compose files publish it). Use `OCPC_STUN_PORT` to change the port (`0` disables it) and `OCPC_STUN_HOST` to set the hostname browsers use (default: the host in `OCPC_PUBLIC_URL`).
- **Through firewalls:** when two people can't connect directly (common in offices and on mobile networks), traffic goes through a **TURN** relay. Without TURN, _some calls will fail to connect_. For production, set up TURN.
- **Large meetings:** with LiveKit configured, larger calls go through a LiveKit media server. Each participant then only uploads their video once.

### Setting up TURN (coturn)

1. Install coturn on a server with a public IP (the same server is fine). Use `deploy/coturn/turnserver.conf` as the config.
2. Generate a secret: `openssl rand -hex 32`. Put it in coturn (`static-auth-secret=`) **and** in OpenCorpoChat (`TURN_SECRET=`).
3. Open the ports: 3478 tcp+udp, 5349 tcp (TLS), and 49160–49200 udp (relay range).
4. Set `TURN_URLS` (and usually `STUN_URLS`) in OpenCorpoChat and restart it.
5. **Troubleshoot:** in the call window, open **Device settings → Call diagnostics** to see whether host, STUN (srflx) and TURN (relay) candidates are found. During a call, running `ocpcCallDebug()` in the browser console shows each peer's ICE state and candidates.
6. **Test it:** start a call between a laptop on office Wi-Fi and a phone on mobile data. If it connects and you can see each other, TURN is working.

> For very restrictive networks that only allow HTTPS, run TURN over TLS on port 443 on a dedicated IP, and add `turns:turn.example.com:443?transport=tcp` to `TURN_URLS`.

### Setting up LiveKit

Use the `livekit` service in `docker-compose.full.yml`, or follow [LiveKit's self-hosting docs](https://docs.livekit.io/home/self-hosting/deployment/). Then set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. No changes are needed in the app; call buttons automatically use LiveKit when it's available.

## 12. Single sign-on (OIDC)

OpenCorpoChat supports any **OpenID Connect** provider. In your provider:

- Create a "web application" client.
- Set the **redirect URI** to:

  ```
  {OCPC_PUBLIC_URL}/api/v1/auth/oidc/callback
  ```

  For example `https://chat.example.com/api/v1/auth/oidc/callback`.

- Request the scopes `openid email profile`.

Then set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`, and restart. A "Sign in with SSO" button appears on the login page.

If someone signs in with SSO and an existing account has the same **verified** email, the SSO login is linked to that account.

To make SSO the _only_ way to log in, turn on **Admin → Authentication → SSO only**. Keep at least one owner with a password as a break-glass account in case your identity provider has an outage.

### Google Workspace

1. In the [Google Cloud console](https://console.cloud.google.com/), go to **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Add the authorized redirect URI above.
3. Set:

   ```env
   OIDC_ISSUER=https://accounts.google.com
   OIDC_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   OIDC_CLIENT_SECRET=...
   OIDC_ALLOWED_DOMAINS=example.com   # important: otherwise any Google account can sign in
   ```

### Microsoft Entra ID

1. In the Entra admin center, go to **App registrations → New registration**. Choose the _Web_ platform and use the redirect URI above.
2. Under **Certificates & secrets**, create a client secret.
3. Set:

   ```env
   OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
   OIDC_CLIENT_ID=<application (client) id>
   OIDC_CLIENT_SECRET=<secret value>
   ```

### Keycloak / Authentik / Okta

Create an OIDC client of type _confidential_ with the redirect URI above. Then use the realm or application issuer URL as `OIDC_ISSUER`, for example `https://sso.example.com/realms/acme` for Keycloak or `https://acme.okta.com` for Okta.

## 13. Email (SMTP)

Email is optional, but it's needed for email invites, password-reset links, and "you have unread messages" digests. Any SMTP provider works: your own mail server, Microsoft 365, Google Workspace SMTP relay, or a transactional provider.

```env
SMTP_URL=smtps://chat%40example.com:app-password@smtp.example.com:465
SMTP_FROM="Example Chat <chat@example.com>"
```

Use **Admin → Email → Send test email** to check it.

## 14. Browser notifications (Web Push)

Web Push works out of the box. The first time it starts, OpenCorpoChat generates its "VAPID" keys and saves them in the data directory. Users turn notifications on in **Preferences → Notifications**.

Things to know:

- Web Push requires **HTTPS**.
- On **iPhone/iPad**, notifications only work after the user adds OpenCorpoChat to their home screen (Share → _Add to Home Screen_). That's a platform rule.
- Push messages are delivered through each browser vendor's push service, which is how Web Push works for every website. The content is encrypted end-to-end between your server and the browser, so the push service can't read it.
- **Don't change the VAPID keys** after people have subscribed. Doing so silently breaks their notifications until they re-enable them.

## 15. File storage (S3)

By default, uploads go to `$OCPC_DATA_DIR/files`. To use S3-compatible storage instead, set the `S3_*` variables and create the bucket first. The bucket should **not** be public: OpenCorpoChat checks permissions and serves files to users itself.

Existing files aren't moved automatically when you switch storage. Plan the switch before you go live, or copy the files into the bucket with the same keys.

Upload limits: `OCPC_MAX_UPLOAD_MB` sets the per-file limit. Allowed file types and an org-wide quota can be set in **Admin → Files**. If you use nginx, raise `client_max_body_size` to match.

## 16. Retention, export and compliance

- **Retention:** **Admin → Retention** sets how long messages and files are kept, org-wide or per channel. A nightly job permanently deletes anything older. The default is to keep everything forever.
- **Audit log:** **Admin → Audit log** records sign-ins, role changes, deletions, exports and settings changes.
- **Org export:** `ocpc export --out org.json` or **Admin → Export**. Exports are recorded in the audit log.
- **Person-level requests** (for example GDPR): in **Admin → Users → (user)** you can export one person's data, deactivate them (they can't log in, but their messages remain), or erase them (their personal data is removed and their messages are attributed to "Deleted user").
- **Data location:** everything stays on your server and your configured services. OpenCorpoChat has no telemetry and makes no outbound calls except to services you configure: SMTP, OIDC, S3, TURN/LiveKit, browser push services, and link previews. Link previews can be turned off in **Admin → Messages**.

## Security checklist

- [ ] HTTPS everywhere. Never expose port 8080 directly to the internet.
- [ ] Finish the setup wizard immediately after installing.
- [ ] `OCPC_TRUST_PROXY=true` only when you're behind your own reverse proxy.
- [ ] Turn on **Admin → Authentication → Require two-factor authentication**, or use SSO with MFA at the identity provider.
- [ ] Restrict invite links to your email domain, and set them to expire.
- [ ] Nightly backups, copied off the server, with a restore you've actually tested.
- [ ] Keep the host OS and Docker updated. Subscribe to [releases](https://github.com/CK42BB/opencorpochat/releases) (Watch → Custom → Releases) to hear about security fixes.
- [ ] Use a non-public S3 bucket with a credential limited to that bucket.
- [ ] TURN: keep the `denied-peer-ip` lines in `turnserver.conf` so your relay can't be used to reach your internal network.

## Troubleshooting

**Server won't start: "Invalid configuration"**
: Read the message. It names the variable and the problem. Check `docker logs ocpc`.

**"Migration failed" on startup**
: Nothing was changed. Restore isn't needed. Check the logs, then [open an issue](https://github.com/CK42BB/opencorpochat/issues) with the error and the version you upgraded from and to. You can go back to the previous image tag.

**Messages don't appear live; you have to refresh**
: Your reverse proxy isn't passing WebSockets through. In nginx, make sure the `/api/v1/ws` block with the `Upgrade`/`Connection` headers is present (see `deploy/nginx/opencorpochat.conf`). Some corporate proxies block WebSockets.

**Calls connect for some people but not others / black video**
: Almost always a missing or misconfigured TURN server ([§11](#11-calls-stun-turn-and-livekit)). Check that `TURN_SECRET` matches coturn, that the relay UDP ports are open, and that coturn's `external-ip` is set if it's behind NAT. The in-app **Call diagnostics** page shows which connection types work.

**No browser notifications**
: The site must be HTTPS, the user must allow notifications in the browser and the OS, and on iOS the app must be added to the home screen.

**SSO: "redirect_uri mismatch"**
: The redirect URI registered with your provider must exactly match `{OCPC_PUBLIC_URL}/api/v1/auth/oidc/callback`, including `https` and with no trailing slash. Check that `OCPC_PUBLIC_URL` is set correctly.

**Uploads fail for large files**
: Raise `OCPC_MAX_UPLOAD_MB`, plus `client_max_body_size` if you use nginx.

**Locked out of the only admin account**
: `docker exec -it ocpc ocpc reset-password --email you@example.com`.

**Still stuck?**
: See [SUPPORT.md](../SUPPORT.md).
