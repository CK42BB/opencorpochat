# Migrating from another chat tool

OpenCorpoChat can bring over your history from a **Slack-format workspace export** or from **Microsoft Teams**. People keep their messages, threads, reactions and files, and each person claims their own account when they are ready.

The migration is built to be safe to run in an organization with legal, privacy or records obligations:

- **Preview first.** Uploading an archive only analyzes it. Nothing is imported until you have reviewed the conversations and people in it and chosen what to bring over.
- **Private by default.** Private channels and direct messages are left out unless you include them **and** confirm that your organization has the authority and a lawful basis to move them, and that the people involved have been told. That confirmation is recorded in the audit log.
- **Data minimization.** Import only the conversations and date range you need, and choose whether to copy files or keep links.
- **Faithful history.** Original authors, timestamps, edits, threads and reactions are kept. Imported history doesn't notify anyone or show up as unread.
- **Chain of custody.** The archive's SHA-256 checksum, the options you chose, and the counts are stored with the import and in the audit log. A full JSON report (including the audit trail) can be downloaded for your records. Teams archives also contain a checksum for every file they hold.
- **Repeatable and reversible.** Running an import again skips anything already imported, so you can import early and then once more at cut-over to catch up. Any import can be undone.
- **No account takeover.** People are created as inactive accounts. Only the person with that email address can claim one: through an invite bound to their address, or by signing in with single sign-on using that verified email. People who had already left your organization are never invited.

Only **owners** can run imports, since they can include private conversations.

## Overview

1. **Prepare.** Tell people about the move. If you import private channels or direct messages, check this with whoever handles privacy or legal matters in your organization. Check the retention setting in **Admin → Settings**: imported messages older than your retention period are deleted by the next retention run.
2. **Export** from your current tool (see below).
3. **Upload** the archive in **Admin → Migrate**, or run `ocpc import --in FILE --dry-run` on the server.
4. **Review the preview and import.** Choose conversations, a date range, and whether to include private channels and direct messages.
5. **Invite people.** In **Admin → Migrate**, choose **Send invites**. With email configured, everyone gets a personal link (valid for 14 days). Otherwise you get a list of links to share. With single sign-on, people can simply sign in.
6. **Cut over.** On the switch-over day, export again and import the new archive. Only messages that are new since the first import are added.
7. **Clean up.** Delete uploaded archives you no longer need (**Delete uploaded archive**). The import record and checksum are kept.

## Exporting from Slack

A workspace owner or admin can export data from the workspace's settings (**Import/Export Data → Export**). Download the ZIP file it produces.

- A standard export contains **public channels** only.
- Exports that include **private channels and direct messages** are only available on some plans, and may need approval from your Slack workspace owner. If your archive includes `groups.json`, `dms.json` or `mpims.json`, the preview lists those conversations.
- **Files:** the export lists files with download links. With **Copy files** on, OpenCorpoChat downloads each file from Slack's file servers while importing (it contacts only those hosts). If a link has expired or needs a sign-in, the message keeps a link to the original file instead, and the report lists it.

## Collecting from Microsoft Teams

Teams doesn't produce a ready-made export archive, so OpenCorpoChat includes a collector that reads your tenant through the publicly documented **Microsoft Graph API** and writes an archive. Collecting and importing are separate steps on purpose: you can review and keep the archive before anything is imported, and the import itself runs offline.

### 1. Register an app in Microsoft Entra ID

In the Microsoft Entra admin center, go to **App registrations → New registration**. Then, under **API permissions → Microsoft Graph → Application permissions**, add:

| Permission                | Needed for                                        |
| ------------------------- | ------------------------------------------------- |
| `Team.ReadBasic.All`      | Listing teams                                     |
| `Channel.ReadBasic.All`   | Listing channels                                  |
| `TeamMember.Read.All`     | Team members                                      |
| `ChannelMessage.Read.All` | Channel messages, replies and inline images       |
| `User.Read.All`           | Names, emails and job titles (recommended)        |
| `ChannelMember.Read.All`  | Only with `--include-private-channels`            |
| `Chat.Read.All`           | Only with `--include-chats` (1:1 and group chats) |
| `Files.Read.All`          | Only with `--download-files`                      |

Choose **Grant admin consent**, then create a client secret under **Certificates & secrets**.

Microsoft treats some Teams message APIs as _protected APIs_ that need extra approval, and may charge for some bulk reads. Check Microsoft's current Graph documentation for your tenant before you start. Grant only the permissions you need, and remove the app registration when the migration is done.

### 2. Run the collector

Run this on the server (or anywhere with network access to Microsoft). Pass the secret through an environment variable so it doesn't end up in your shell history:

```bash
export OCPC_GRAPH_CLIENT_SECRET='…'
ocpc collect-teams --out teams.zip --tenant <tenant-id> --client-id <app-id>
```

In Docker, use `docker exec -it -e OCPC_GRAPH_CLIENT_SECRET ocpc ocpc collect-teams --out /data/teams.zip …`.

Options:

| Option                       | Effect                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `--teams "Sales,Product"`    | Collect only these teams (names or ids). All teams by default.                      |
| `--since 2024-01-01`         | Skip threads that started before this date.                                         |
| `--include-private-channels` | Also collect private and shared channels.                                           |
| `--include-chats`            | Also collect 1:1, group and meeting chats.                                          |
| `--download-files`           | Copy files shared in messages (from SharePoint/OneDrive). Otherwise links are kept. |
| `--max-file-mb 100`          | Skip files larger than this.                                                        |

Instead of an app secret, you can provide a Graph access token in `OCPC_GRAPH_TOKEN`. The collector sends credentials only to `graph.microsoft.com` and `login.microsoftonline.com`. It waits and retries automatically when Microsoft asks it to slow down. Anything it couldn't read is listed as a warning, both in its output and in the archive.

The archive contains unmodified Graph JSON plus `ocpc-teams-manifest.json`, which records when the archive was collected, with which options, and the SHA-256 of every file in it. Upload it in **Admin → Migrate** like a Slack export.

### How Teams maps to OpenCorpoChat

- Each team's **General** channel becomes a channel named after the team, for example `#product`. Other channels become `#team-channel`, for example `#product-design`.
- Private and shared channels become **private channels** with the same members.
- 1:1 chats become **direct messages**. Group and meeting chats become **group messages**.
- Inline images become attachments. Files shared in messages are copied with `--download-files`; otherwise the message keeps a link to the original file.
- Messages from apps keep the app's name. Adaptive cards aren't imported; a note marks where one was.

## Importing from the command line

For archives too large to upload (over `OCPC_MAX_IMPORT_MB`, 2048 MB by default), or for scripting:

```bash
ocpc import --in export.zip --dry-run     # preview only
ocpc import --in export.zip               # public channels
ocpc import --in export.zip --include-private --include-dms --acknowledge-private
ocpc import --in export.zip --channels general,design --since 2023-01-01 --no-files
```

`--in` also accepts an unzipped folder. Command-line imports appear in **Admin → Migrate** and the audit log like any other import. Use **Undo import** there to reverse one. `ocpc import-slack` still works as an alias.

## What happens to people

- People are matched to existing accounts **by email**. Everyone else gets an **inactive** account with their name and title. Their messages, reactions and channel memberships are attached to it.
- Bots and apps don't get accounts; their messages show the bot's name. People with no email address in the export get an inactive account that can't be invited (an admin can set an email for it in **Admin → People**).
- A person claims their account through an invite bound to their email address (**Admin → Migrate → Send invites**), or by signing in with single sign-on with that verified email. They choose their own username and password. Their history and channels are waiting for them.
- People marked as deleted or disabled in the source are imported for history, but are never invited and cannot claim their account.

## Channels that already exist

With **Merge into existing channels with the same name** (on by default), history from `#general` goes into your existing `#general`. Only channels of the same type are merged, so private history never lands in a public channel. Turn the option off (or use `--no-merge`) to create renamed copies such as `#general-imported` instead.

## Undo

**Undo import** removes the channels the import created and the messages and files it added to existing channels. It also removes inactive accounts nobody has claimed, unless other history still refers to them. Accounts people have already claimed are kept. Undo is recorded in the audit log.

## Limits

- ZIP archives must be smaller than 4 GB. For bigger exports, unzip them and import the folder with `ocpc import --in FOLDER`.
- Message bodies longer than 40,000 characters are truncated (the report lists them).
- Behind nginx, raise `client_max_body_size` for `/api/v1/admin/imports` (see `deploy/nginx/opencorpochat.conf`) or use the command line.

"Slack" and "Microsoft Teams" are trademarks of their respective owners. They are used here only to describe compatibility. OpenCorpoChat is not affiliated with either company.
