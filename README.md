# hacker-hud

A [Claude Code](https://code.claude.com) mod that turns the desktop app's Code tab into a green-on-black hacker terminal and adds a few small tools that earn their place in every session.

## What you get

**Theme (desktop and mobile apps)**
- A dark green-on-black palette for the whole Code tab.
- A backdrop of mirrored half-width katakana code raining down behind the conversation.

**Status line (under the prompt)**

One quiet line that only shows what is worth showing:

```
⏱ 1m 12s · 14 tools  ·  $0.42  ·  context 72% ⚠  ·  ⎇ feature/x ↑2 ↓5 · ✎ 3
```

| Part | Shown when |
|---|---|
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

At the prompt of a Claude Code terminal session:

```
/plugin install hacker-hud --marketplace adomorn/hacker-hud
```

Answer `y` to add the marketplace, then pick the user scope.

From a shell:

```bash
claude plugin install hacker-hud --marketplace adomorn/hacker-hud
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `adomorn/hacker-hud`, then **Add plugin**.

The mod loads in every new session. To turn it off:

```bash
claude plugin disable hacker-hud@hacker-hud
```

## Requirements and known issues

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
| Announcements | the MP3 files in `sounds/` |

Run the tests with:

```bash
claude plugin test .
```

## Credits

- `hooks/make-colors.js` and `hooks/make-colors.d.ts` are copied unchanged from Claude Code's `plugin-authoring` skill, which provides them for mods to build a theme's colors.
- The announcements were generated with ElevenLabs.

## License

MIT, see [LICENSE](LICENSE). This covers the mod's own code; `hooks/make-colors.js` and `hooks/make-colors.d.ts` keep the terms they ship with in Claude Code.
