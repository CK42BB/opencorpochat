# Getting started

Pick a path. Each one takes about five minutes.

| Path                                                                                      | Best for               | You need                              |
| ----------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------- |
| [A. Try it locally](#a-try-it-locally-in-60-seconds)                                      | Kicking the tyres      | Docker                                |
| [B. Production on a small VPS](#b-production-on-a-10-vps-docker-compose--automatic-https) | Most teams             | A Linux server, a domain name, Docker |
| [C. From source](#c-from-source)                                                          | Developers, forks      | Node.js 22, pnpm                      |
| [D. Bare metal with systemd](#d-bare-metal-with-systemd)                                  | Servers without Docker | Node.js 22, pnpm, a reverse proxy     |

When you're done, work through the [first-day checklist](#first-day-checklist-for-admins).

---

## A. Try it locally in 60 seconds

```sh
docker run -d --name ocpc -p 8080:8080 -v ocpc-data:/data \
  -e OCPC_PUBLIC_URL=http://localhost:8080 \
  ghcr.io/ck42bb/opencorpochat:latest

# Optional: fill it with a demo company
docker exec -it ocpc ocpc seed-demo
```

Open **http://localhost:8080**.

- **If you ran `seed-demo`:** sign in as `demo@brightfield.example` with the password printed in your terminal. You'll find "Brightfield Studio", about 12 people, channels with threads, reactions and a poll, and a CI bot posting through a webhook.
- **If you didn't:** the setup wizard asks for your organization name and creates your owner account.

`seed-demo` only runs on an empty instance. Add `--force` to run it anyway.

To throw everything away afterwards:

```sh
docker rm -f ocpc && docker volume rm ocpc-data
```

---

## B. Production on a $10 VPS (Docker Compose + automatic HTTPS)

This setup runs the app with SQLite and local file storage behind [Caddy](https://caddyserver.com), which gets and renews HTTPS certificates for you. It comfortably handles 200 people on 1 vCPU and 1–2 GB of RAM.

**1. Point a domain at the server.** Create a DNS **A** record (and **AAAA** if you have IPv6), for example `chat.example.com` pointing to your server's IP.

**2. Open the firewall:**

| Port                     | Why                                                    |
| ------------------------ | ------------------------------------------------------ |
| 80/tcp, 443/tcp, 443/udp | Web app and HTTPS certificate issuance                 |
| 3478/udp                 | Built-in STUN server, so calls connect across networks |

```sh
# Example with ufw
sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw allow 3478/udp
```

**3. Download the compose files and configure:**

```sh
git clone https://github.com/CK42BB/opencorpochat.git
cd opencorpochat/deploy/compose
cp .env.example .env
nano .env          # set OCPC_DOMAIN=chat.example.com
docker compose up -d
```

**4. Open `https://chat.example.com` and finish the setup wizard right away.** Until the wizard is done, anyone who reaches the server can claim the owner account.

**Need more?** [`docker-compose.full.yml`](../deploy/compose/docker-compose.full.yml) adds PostgreSQL, MinIO (S3 storage), coturn (TURN relay) and LiveKit (large calls). See [admin guide §4](admin-guide.md#4-full-setup-postgres-s3-turn-livekit).

---

## C. From source

Requirements: **Node.js ≥ 22.12** and **pnpm 10** (`corepack enable`).

```sh
git clone https://github.com/CK42BB/opencorpochat.git
cd opencorpochat
pnpm install
pnpm build
OCPC_PUBLIC_URL=http://localhost:8080 pnpm start
```

Open http://localhost:8080. Data goes to `./data` by default; change it with `OCPC_DATA_DIR`.

To load demo data:

```sh
pnpm cli seed-demo
```

For development with hot reload:

```sh
pnpm dev
# API on :8080, web app on http://localhost:5173
```

See the [development guide](development.md).

---

## D. Bare metal with systemd

```sh
sudo git clone https://github.com/CK42BB/opencorpochat.git /opt/opencorpochat
cd /opt/opencorpochat
sudo corepack enable
pnpm install --frozen-lockfile && pnpm build

sudo useradd --system --home /var/lib/opencorpochat --create-home ocpc
sudo mkdir -p /etc/opencorpochat
sudo cp deploy/compose/.env.example /etc/opencorpochat/env
sudo nano /etc/opencorpochat/env    # set OCPC_PUBLIC_URL=https://chat.example.com
sudo cp deploy/systemd/opencorpochat.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now opencorpochat
```

Put a reverse proxy in front for HTTPS. [`deploy/nginx/opencorpochat.conf`](../deploy/nginx/opencorpochat.conf) is a ready-made nginx config; make sure WebSocket upgrades on `/api/v1/ws` are forwarded. Then set `OCPC_TRUST_PROXY=true`.

Run CLI commands as the service user:

```sh
sudo -u ocpc OCPC_DATA_DIR=/var/lib/opencorpochat node /opt/opencorpochat/apps/server/dist/cli.js --version
```

---

## First-day checklist for admins

| ✓   | Task                                                                                                                 | Where                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| ☐   | Finish the setup wizard and set the org name and icon                                                                | **Admin → Settings**                                                  |
| ☐   | Turn on two-factor authentication for your own account                                                               | **Settings → Account & security**                                     |
| ☐   | Configure email so invites, reset links and digests are sent (`SMTP_URL`, `SMTP_FROM`), then use **Send test email** | [Admin guide §13](admin-guide.md#13-email-smtp), **Admin → Overview** |
| ☐   | Connect single sign-on (optional): set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`                         | [Admin guide §12](admin-guide.md#12-single-sign-on-oidc)              |
| ☐   | Decide on policies: require 2FA, allowed sign-up domains, guests, retention, upload limits                           | **Admin → Settings**                                                  |
| ☐   | Create channels and mark the ones everyone should join as **default**                                                | Channel details → Settings                                            |
| ☐   | Invite your team: create a reusable link or per-email invites                                                        | **Invite people** in the sidebar, or **Admin → Invites**              |
| ☐   | Schedule nightly backups and copy them off the server                                                                | [Admin guide §9](admin-guide.md#9-backups-and-restore)                |
| ☐   | Test a call between two different networks. If it fails, set up TURN                                                 | [Admin guide §11](admin-guide.md#11-calls-stun-turn-and-livekit)      |
| ☐   | Subscribe to releases: **Watch → Custom → Releases** on GitHub                                                       | [Releases](https://github.com/CK42BB/opencorpochat/releases)          |

**Moving from another chat tool?** If you have a Slack-format workspace export, import it with:

```sh
docker exec -it ocpc ocpc import-slack --in /data/export.zip
```

Imported people become inactive placeholder accounts until you invite them.
