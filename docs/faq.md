# Frequently asked questions

### Is it really free? Is there a paid edition?

Yes, it's really free, and there's no paid edition. Every feature is in the open-source code under AGPL-3.0. You pay only for the server you run it on.

### How many people can it handle?

It's designed for organizations of up to about 200 people. A 50-person team runs comfortably on 1 vCPU and 1 GB RAM with the default SQLite database. Larger teams should use PostgreSQL, and teams with big video meetings should add LiveKit.

### Do I need to be a developer to run it?

No. If you can follow the [Docker Compose steps](admin-guide.md#3-recommended-production-setup-docker-compose--https), which come down to editing one line and running one command, you can run it. Upgrades are `docker compose pull && docker compose up -d`.

### Can we move our history over from our current chat tool?

If your current tool can produce a **Slack-format workspace export archive** (a ZIP of JSON files), `ocpc import-slack` imports its channels, users and messages. Other tools can be supported through the documented import format. Contributions of new importers that use publicly documented export formats are welcome.

### Is it affiliated with Slack or Microsoft?

No. OpenCorpoChat is an independent, original project. It uses only open standards and publicly documented formats. Other companies' product names appear in our docs only to describe compatibility.

### Is it end-to-end encrypted?

Not in v1. Traffic is encrypted in transit with HTTPS, and you control the server and its disk, so you can encrypt storage at rest. End-to-end encryption is on the long-term roadmap (PRD §6.11).

### Does it phone home or collect telemetry?

No. It makes no outbound connections unless you configure a service that needs one (email, SSO, S3, TURN/LiveKit, browser push, link previews). The optional "update available" check is off by default.

### Is there a mobile app?

OpenCorpoChat is a **Progressive Web App (PWA)**. On a phone, open your chat URL and choose *Add to Home Screen* or *Install app*. You get an app icon, full-screen use and push notifications, including on iOS 16.4 and later. Native apps are a possible future addition.

### What does the AGPL mean for my company?

You can use and modify OpenCorpoChat internally with no obligations. If you **modify** it and let people use your modified version over a network, you must offer those users its source code. The built-in "Source code" link (`OCPC_SOURCE_URL`) makes that easy. Bots and integrations that talk to the API are separate programs and can use any license. This is not legal advice. See [ADR 0004](adr/0004-agpl-license.md).

### Can we change the name/logo/colors for our company?

Yes. Change the org name and logo in the admin console. For deeper rebranding, fork it and edit the design tokens in the web app. If you redistribute a substantially modified version, please give it its own name.

### Can we run multiple organizations on one server?

Each instance serves one organization, which keeps things simple and secure. To host several organizations, run several instances, for example one compose stack each.

### How do I get help?

See [SUPPORT.md](../SUPPORT.md).
