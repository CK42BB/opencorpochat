# Export format (NDJSON)

An organization export comes from **Admin → Export**, `GET /api/v1/admin/export`, or `ocpc export --out file.ndjson`. It is a newline-delimited JSON file with one record per line:

```json
{"type":"meta","data":{"format":"ocpc-export","version":1,"exportedAt":"2026-10-09T12:00:00.000Z","scope":"org"}}
{"type":"org","data":{"name":"Acme", "...": "..."}}
{"type":"user","data":{"id":"01J...","email":"...","username":"...","display_name":"...","role":"member","created_at":"..."}}
{"type":"channel","data":{"id":"...","kind":"public","name":"general","...":"..."}}
{"type":"channel_member","data":{"channel_id":"...","user_id":"...","role":"member","joined_at":"..."}}
{"type":"message","data":{"id":"...","channel_id":"...","user_id":"...","thread_root_id":null,"body":"Hello","created_at":"..."}}
{"type":"reaction","data":{"message_id":"...","user_id":"...","emoji":"👍"}}
{"type":"pin","data":{"channel_id":"...","message_id":"..."}}
{"type":"file","data":{"id":"...","name":"report.pdf","mime":"application/pdf","size":12345,"storage_key":"01/01J..."}}
```

Notes:

- IDs are [ULIDs](https://github.com/ulid/spec): lexicographically sortable and timestamp-prefixed. Timestamps are ISO-8601 UTC.
- Record order is: `meta`, `org`, `user`, `channel`, `channel_member`, `user_group`, `user_group_member`, `custom_emoji`, `message` (in ID order), `reaction`, `pin`, `file`.
- **Secrets are never exported.** That includes password hashes, 2FA secrets, API token hashes and webhook secrets.
- File contents are not inside the NDJSON. They live in your storage backend under `storage_key`: the `files/` folder of the data directory, or your S3 bucket. `ocpc backup` copies them for local storage.
- A per-person export (data-subject access request), from **Admin → Users → Export data**, uses the same format with `scope: "user"`. It contains that person's profile, messages, reactions and uploaded file metadata.

The format is versioned. Any breaking change will increment `version`.
