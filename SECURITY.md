# Security Policy

We take the security of OpenCorpoChat seriously. Because it's self-hosted, the organizations that run it depend on us to fix vulnerabilities quickly and communicate clearly.

## Supported versions

| Version | Supported |
|---|---|
| Latest minor release (e.g. `1.4.x`) | ✅ Security fixes |
| Previous minor release (e.g. `1.3.x`) | ✅ Security fixes for 90 days after the next minor ships |
| Older releases | ❌ Please upgrade |
| `main` branch (unreleased) | ✅ Best effort |

Before 1.0, only the latest `0.x` release is supported.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for security problems.**

1. **Preferred:** Use GitHub's [private vulnerability reporting](https://github.com/opencorpochat/opencorpochat/security/advisories/new) ("Report a vulnerability" on the Security tab).
2. **Alternative:** Email **security@opencorpochat.org**. <!-- Maintainers: replace with a real, monitored address before launch. -->

Please include:

- The affected version or commit
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Any suggested fix or mitigation

## What to expect

| Step | Target |
|---|---|
| Acknowledgement of your report | within **72 hours** |
| Initial assessment and severity rating (CVSS) | within **7 days** |
| Fix released for critical/high issues | as fast as possible, normally within **30 days** |
| Public disclosure | coordinated, at most **90 days** after the report |

We'll keep you informed as we go. Once a fix is available, we publish a GitHub Security Advisory, request a CVE where appropriate, and credit you unless you'd prefer to stay anonymous.

If a vulnerability is being actively exploited, we may shorten the disclosure timeline so admins can protect themselves sooner.

## Scope

In scope: the code in this repository (server, web client, CLI, official Docker image and deployment examples).

Out of scope:

- Vulnerabilities in third-party services you connect (your OIDC provider, S3, SMTP, TURN, LiveKit). Please report those upstream.
- Issues that require a malicious instance administrator. Admins can already read all data on their own server.
- Missing hardening on deployments that ignore the documented setup (for example, running without TLS).
- Denial of service that needs unrealistic resources, and findings from automated scanners that come without a demonstrated impact.

## Safe harbor

We won't pursue legal action against anyone who researches security in good faith within this policy. That means: don't access other people's data, don't degrade service for others, give us reasonable time to fix the issue before disclosing, and only test against instances you own or have permission to test.

## Hardening guidance for admins

See the security section of the [Admin Guide](docs/admin-guide.md#security-checklist).
