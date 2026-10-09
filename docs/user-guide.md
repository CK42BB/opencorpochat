# User guide

Everything you need for day-to-day use. Press **`?`** anywhere in the app to see the keyboard shortcuts.

## The sidebar

| Item                                     | What it is                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Threads**                              | Every thread you started, replied to or followed, newest first. A badge means there are new replies. |
| **Activity**                             | Mentions, DMs, thread replies, keyword matches and reminders.                                        |
| **Saved**                                | Messages you bookmarked. Only you can see them.                                                      |
| **Browse channels**                      | Every public channel. Join with one click.                                                           |
| **People**                               | Everyone in the organization, plus user groups.                                                      |
| **Starred / Channels / Direct messages** | Your conversations. Bold means unread; a red number means you were mentioned.                        |

You can organize the sidebar under **Settings → Sidebar**: create your own sections (for example "Clients" or "Projects") and add conversations to them. Star a channel to pin it to the top. Collapse a section by clicking its name.

## Channels, DMs and threads

- **Public channels** (`#name`) are visible to everyone and anyone can join.
- **Private channels** (🔒) are invisible to non-members and require an invitation.
- **Direct messages** are 1:1 conversations. **Group DMs** hold up to 9 people. Start one with the ✏️ button at the top of the sidebar.
- **Announcement channels:** only admins can post, but everyone can reply in threads.
- **Threads:** hover over a message and click 💬 to reply in a thread. Tick **Also send to channel** when the whole channel should see your reply. Click the 🔔 in a thread to follow or unfollow it.

## Mentions

| Type                      | Who gets notified                                             |
| ------------------------- | ------------------------------------------------------------- |
| `@sam`                    | Sam                                                           |
| `@design`                 | Every member of the user group "design" who is in the channel |
| `@here`                   | Channel members who are online right now                      |
| `@channel` or `@everyone` | Every member of the channel                                   |
| `#channel-name`           | Nobody; it creates a link to the channel                      |

Start typing `@`, `#` or `:` to get suggestions.

## Formatting

| You type                           | You get                               |
| ---------------------------------- | ------------------------------------- |
| `**bold**` or Ctrl/⌘ + B           | **bold**                              |
| `_italic_` or Ctrl/⌘ + I           | _italic_                              |
| `~~strike~~` or Ctrl/⌘ + Shift + X | ~~strike~~                            |
| `` `code` ``                       | `code`                                |
| ` ```js ` … ` ``` `                | Code block with syntax highlighting   |
| `> quote`                          | Block quote                           |
| `- item` / `1. item`               | Lists                                 |
| `[text](https://…)`                | Link                                  |
| `:tada:`                           | 🎉 (and custom emoji like `:shipit:`) |

Press **Enter** to send and **Shift + Enter** for a new line. If you prefer Ctrl/⌘ + Enter to send, switch it in **Settings → Appearance**. Start a message with `//` to send text that begins with a slash.

## Reactions, edits and the message menu

Hover over a message to see quick reactions, the emoji picker, **Reply in thread**, **Save**, and **⋯** for more actions:

- edit or delete
- pin to the channel
- forward to another conversation
- copy link or text
- mark unread
- set a reminder (20 minutes, 1 hour, tomorrow, or a custom time)

Press **↑** in an empty composer to edit your last message.

## Files

Drag files onto the composer, paste them, or click 📎. Images, video and audio play inline, and PDFs open in your browser. Every channel's **Details → Files** tab lists what's been shared there.

## Search

Press **Ctrl/⌘ + K** to jump to any conversation or person. Type a phrase and press Enter to search messages. You can also use **Ctrl/⌘ + Shift + F**.

| Filter                       | Example                                | Finds                                         |
| ---------------------------- | -------------------------------------- | --------------------------------------------- |
| `in:`                        | `in:#design logo`                      | Messages in #design                           |
| `from:`                      | `from:@sam invoice`                    | Messages from Sam                             |
| `before:` / `after:` / `on:` | `after:2026-01-01`                     | Messages in a date range                      |
| `has:`                       | `has:file`, `has:link`, `has:reaction` | Messages with attachments, links or reactions |
| `is:`                        | `is:thread`, `is:pinned`, `is:saved`   | Threads, pinned or saved messages             |
| `"…"`                        | `"launch plan"`                        | An exact phrase                               |

## Notifications

- **Per channel:** in **Details → Settings**, choose _All new messages_, _Mentions and keywords_ (the default for channels) or _Nothing_. You can also **Mute** a channel.
- **Desktop and phone notifications:** enable them in **Settings → Notifications**. Install the app (see below) for the best experience.
- **Keywords:** get notified whenever words like "invoice" or your project name appear.
- **Schedule:** only get notified during working hours.
- **Do Not Disturb:** click your name at the bottom of the sidebar and choose **Pause notifications**. You can also type `/dnd 2h`.
- **Email:** if you're away, you get an email digest of missed mentions and DMs. You can turn it off or change the delay.

## Status

Click your name → **Set a status**: pick an emoji, add text and set when it should clear. You can also type `/status :palm_tree: On vacation`.

## Saved items, reminders and scheduled messages

- **Save** a message (🔖) to find it under **Saved**.
- **Reminders:** use the ⋯ menu on a message, or type `/remind me in 30m to call the bank`. Your reminders are listed in **Settings → Scheduled & reminders**.
- **Schedule a message:** click **+** in the composer → **Schedule message**.

## Polls

Click **+** in the composer → **Create a poll**. Polls can allow multiple choices or be anonymous, and the creator can close them.

## Calls and huddles

- **In a DM:** click 📞 to call. The other person's app rings.
- **In a channel:** click 🎧 to start a huddle that anyone in the channel can join from the banner.
- **In the call window:** mute, camera, share screen, ⚙️ device settings (microphone, camera, speaker, plus **Call diagnostics**), expand, and hang up.

If a call won't connect, open **Call diagnostics** and send a screenshot to your admin.

## Slash commands

| Command                          | Does                                               |
| -------------------------------- | -------------------------------------------------- |
| `/remind me in 10m to stretch`   | Sets a reminder (`m`, `h`, `d`, `w` or `tomorrow`) |
| `/status :coffee: Brewing`       | Sets your status                                   |
| `/dnd 1h` · `/dnd off` · `/away` | Pauses or resumes notifications                    |
| `/invite @sam @alex`             | Adds people to the channel                         |
| `/topic New topic`               | Sets the channel topic                             |
| `/call`                          | Starts a call or huddle here                       |
| `/msg @sam hello`                | Sends a direct message                             |
| `/me waves` · `/shrug`           | Fun                                                |
| `/leave`                         | Leaves the channel                                 |

Your admin may have added custom commands. Type `/` to see them all.

## Keyboard shortcuts

| Keys                     | Action                              |
| ------------------------ | ----------------------------------- |
| Ctrl/⌘ + K               | Jump to a conversation              |
| Ctrl/⌘ + Shift + F       | Search messages                     |
| Alt + ↑ / ↓              | Previous / next conversation        |
| Alt + Shift + ↑ / ↓      | Previous / next unread conversation |
| Ctrl/⌘ + Shift + A       | Open the next unread conversation   |
| Ctrl/⌘ + Shift + T       | Open Threads                        |
| Ctrl/⌘ + Shift + M       | Open Activity                       |
| ↑ (in an empty composer) | Edit your last message              |
| Esc                      | Close the thread or details panel   |
| Shift + Esc              | Mark all conversations read         |
| Enter / Shift + Enter    | Send / new line (configurable)      |
| Ctrl/⌘ + B, I, Shift + X | Bold, italic, strikethrough         |
| ?                        | Show keyboard shortcuts             |

## Install it as an app

OpenCorpoChat is a Progressive Web App: it installs like a native app, gets its own window and icon, and can receive push notifications.

| Device                                              | How                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Chrome / Edge (Windows, macOS, Linux, ChromeOS)** | Click the install icon in the address bar, or ⋮ → **Install OpenCorpoChat**                                         |
| **Android (Chrome)**                                | ⋮ → **Add to Home screen** / **Install app**                                                                        |
| **iPhone / iPad (Safari, iOS 16.4+)**               | Share → **Add to Home Screen**. Open it from the home screen, then enable notifications in Settings → Notifications |
| **Firefox (desktop)**                               | Keep it as a pinned tab. Notifications work while it's open                                                         |

## Your account

Under **Settings**:

- **Profile:** name, title, pronouns, photo and time zone.
- **Account & security:** password, two-factor authentication, and signed-in devices. You can sign out any device remotely.
- **Integrations:** personal API tokens for your own scripts.
