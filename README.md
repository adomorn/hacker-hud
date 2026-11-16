# hacker-hud

A [Claude Code](https://code.claude.com) mod that turns the desktop app's Code tab into a green-on-black hacker terminal and adds a few small tools that earn their place in every session.

## What you get

**Theme (desktop and mobile apps)**
- A dark green-on-black palette for the whole Code tab.
- A backdrop of mirrored half-width katakana code raining down behind the conversation.

**Status line (under the prompt)**

One quiet line that only shows what is worth showing:

```
▸ my-app  ·  ⏱ 1m 12s · 14 tools  ·  $0.42  ·  context 72% ⚠  ·  ⎇ feature/x ↑2 ↓5 · ✎ 3
```

| Part | Shown when |
|---|---|
| The session's folder | always, so the line never disappears |
| Last turn's duration and tool calls | after the first turn |
| Session cost | it is above $0 |
| Context usage, with ⚠ at 70% and ‼ at 85% | it reaches 60% |
| Five-hour usage limit and its reset time | it reaches 50% |
| Running subagents | at least one is running |
| Branch, commits ahead ↑ / behind ↓, uncommitted files ✎ | the folder is a git repository |

**Guards**

Claude asks for your approval, even in auto mode, before it:
- runs `git push --force`, `git reset --hard`, `git clean -f`, `rm -rf`, `DROP TABLE` / `TRUNCATE TABLE`, a `DELETE FROM` without `WHERE`, or `dotnet ef database drop`;
- writes something that looks like a private key or an AWS, GitHub, Anthropic, OpenAI, Slack, Google or live Stripe key into a file.

`git push --force-with-lease` and a `DELETE` with a `WHERE` pass untouched. A command your permission rules already deny stays denied.

**Spoken announcements**

| You hear | When |
|---|---|
| "I have a question for you." | Claude asks you a question, presents a plan for approval, or ends its turn with a question |
| "Your approval is needed." | a guard above asks for your approval |
| "Task complete." | a turn you started, and that ran longer than 30 seconds, ends |

Nothing plays for the tool calls auto mode approves on its own, and two announcements never overlap.

## Install

At the prompt of a Claude Code terminal session, run these one at a time:

```
/plugin marketplace add adomorn/hacker-hud
```

```
/plugin install hacker-hud@hacker-hud
```

The second command opens the plugin's details; pick the user scope there.

From a shell (also the way to install it for the desktop app):

```bash
claude plugin marketplace add adomorn/hacker-hud
```

```bash
claude plugin install hacker-hud@hacker-hud
```

A shell install loads in the next session you start, or run `/reload-plugins` in a session that is already open. Check it with `claude plugin list`.

## Updates

Claude Code doesn't update plugins from GitHub marketplaces on its own until you turn it on, once:

1. Run `/plugin` and open the **Marketplaces** tab.
2. Select `hacker-hud`, then **Enable auto-update**.

From then on, Claude Code checks for a new version in the background a few minutes after your first message in a session. The new version loads in your next session, or after `/reload-plugins`.

To update by hand instead:

```bash
claude plugin marketplace update hacker-hud
```

```bash
claude plugin update hacker-hud@hacker-hud
```

## Turning it off

The mod loads in every new session. To turn it off:

```bash
claude plugin disable hacker-hud@hacker-hud
```

## Requirements and known issues

- Claude Code 2.1.287 or later in the terminal, or 2.1.286 or later in the desktop app, for mods to load at all; older versions install the plugin but never run it. Check with `claude --version`.
- Claude Code 2.1.324 or later for the desktop colors. The terminal keeps its own colors and draws no backdrop; the status line and guards work there too.
- Announcements play with `afplay` on macOS. Linux and Windows terminals have no player, so they stay silent.
- On some desktop app versions on macOS, theme backdrops are drawn as a still picture and do not animate ([anthropics/claude-code#109766](https://github.com/anthropics/claude-code/issues/109766)). The code rain starts moving once the app plays scene animations.

## Changing it

| What | Where |
|---|---|
| Colors | `hooks/register.tsx` (`makeColors`) |
| The code rain: glyphs, speed, density | `tools/make_matrix_scene.py`, then run `python3 tools/make_matrix_scene.py` to rebuild `hooks/scene.js` |
| Status line parts and thresholds | `hooks/session-tools.ts` (`refresh`) |
| Guard patterns | `hooks/session-tools.ts` (`DANGEROUS`, `SECRETS`) |
| Announcements | drop your own `done-voice.mp3`, `approve-voice.mp3` or `question-voice.mp3` into a `sounds-local/` folder next to `sounds/`; any file there plays instead of the shipped one, and git ignores the folder |

Run the tests with:

```bash
claude plugin test .
```

## Credits

- `hooks/make-colors.js` and `hooks/make-colors.d.ts` are copied unchanged from Claude Code's `plugin-authoring` skill, which provides them for mods to build a theme's colors.
- The announcements were generated with ElevenLabs.

## License

MIT, see [LICENSE](LICENSE). This covers the mod's own code; `hooks/make-colors.js` and `hooks/make-colors.d.ts` keep the terms they ship with in Claude Code.
