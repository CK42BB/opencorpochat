# Realtime (WebSocket) API

Connect to `wss://<server>/api/v1/ws`:

- **Browsers** authenticate with the session cookie.
- **Bots** can pass `?token=<api token>` or an `Authorization: Bearer` header.

The server pings every 30 seconds. Clients may also send `{"type":"ping"}`, and the server replies with `{"type":"pong"}`.

## Server → client

Every frame has the shape `{"type": string, "seq": number, "data": object}`:

- `seq` increases by one with each frame on a connection.
- After a reconnect, refetch `GET /api/v1/bootstrap` and the visible message lists to fill any gap.
- The authoritative type definitions are in [`packages/shared/src/events.ts`](../../packages/shared/src/events.ts).

| type                                                                   | data                                                        | sent to                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `hello`                                                                | `{connectionId, serverTime, userId}`                        | the new connection                                         |
| `message.created` / `message.updated`                                  | `{message}`                                                 | channel members                                            |
| `message.deleted`                                                      | `{messageId, channelId, threadRootId}`                      | channel members                                            |
| `reaction.updated`                                                     | `{messageId, channelId, reactions}`                         | channel members                                            |
| `channel.created`                                                      | `{channel}` (with your membership and unread counts)        | the user who joined                                        |
| `channel.updated`                                                      | `{channel}`                                                 | channel members                                            |
| `channel.removed`                                                      | `{channelId}`                                               | the user who left or was removed                           |
| `channel.member_joined` / `channel.member_left`                        | `{channelId, userId, memberCount}`                          | channel members                                            |
| `membership.updated`                                                   | `{membership, unreadCount, mentionCount}`                   | that user                                                  |
| `typing`                                                               | `{channelId, threadRootId, userId}`                         | channel members                                            |
| `presence`                                                             | `{userId, presence}` (`online`, `away`, `offline` or `dnd`) | everyone                                                   |
| `user.created` / `user.updated`                                        | `{user}`                                                    | everyone                                                   |
| `pin.updated`                                                          | `{channelId, messageId, pinned}`                            | channel members                                            |
| `saved.updated`                                                        | `{messageId, saved}`                                        | that user                                                  |
| `notification`                                                         | `{notification}`                                            | that user                                                  |
| `thread.updated`                                                       | `{rootId, channelId, unread}`                               | that user                                                  |
| `group.updated` / `group.deleted`, `emoji.updated`, `settings.updated` |                                                             | everyone                                                   |
| `call.updated`                                                         | `{call or null, channelId}`                                 | channel members                                            |
| `call.ring`                                                            | `{call, fromUserId}`                                        | DM members being called                                    |
| `call.signal`                                                          | `{callId, fromUserId, fromConnectionId, signal}`            | one connection                                             |
| `session.revoked`                                                      | `{}`                                                        | the revoked session; the socket then closes with code 4001 |

Message payloads in broadcasts always carry `saved: false`, because saved state is per viewer. Clients keep their own saved state.

## Client → server

```jsonc
{"type": "typing", "channelId": "...", "threadRootId": null}   // throttled server-side
{"type": "presence", "presence": "away"}                       // or "online"
{"type": "call.signal", "callId": "...", "toConnectionId": "...", "signal": {"kind": "offer", "sdp": "..."}}
{"type": "ping"}
```
