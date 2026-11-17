// Tools that run in every session: a status line under the prompt, guards for destructive
// commands and leaked secrets, and spoken announcements.
// Rule of thumb: a piece shows only when it has something worth showing, and a piece that
// fails is left out without taking the others, or the session, with it.
import type { EngineInterface, On } from 'claude-code'

import { concern } from './guards'

// Spoken announcements shipped with the mod. A file of the same name in `sounds-local/`
// (ignored by git) plays instead, so you can record your own or use another language.
const SOUND_DONE = 'done-voice.mp3' // "Task complete. System clean."
const SOUND_APPROVE = 'approve-voice.mp3' // "Warning. Your approval is required."
const SOUND_QUESTION = 'question-voice.mp3' // "Connection open. I have a question for you."
const REFRESH_MS = 20_000
const DONE_SOUND_AFTER_MS = 30_000
// The longest clip runs a little over 3 seconds; a second announcement inside this window is skipped.
const QUIET_MS = 3_500

// ---- turn state ------------------------------------------------------------------

let turnTools = 0
// A prompt you typed is waiting for its turn; the turn it starts is yours.
let promptPending = false
let userTurn = false
// Set when a turn puts a question to you, so its end doesn't also announce "Task complete".
let askedThisTurn = false
let lastTurn: { ms: number; tools: number } | undefined

// Prompts that come from you: typed at the prompt, from the phone, or sent by the app you use.
// Notifications, timers, channels and other sessions start turns too, and are left out.
const YOUR_PROMPTS = new Set(['composer', 'bridge', 'sdk'])

// ---- status line -----------------------------------------------------------------

let refreshing = false
let refreshAgain = false

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)

  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Reads `## main...origin/main [ahead 2, behind 5]` and counts the changed files. */
export function parseGit(stdout: string): { branch: string; ahead: number; behind: number; dirty: number } | undefined {
  const lines = stdout.split('\n').filter(l => l !== '')
  const head = lines[0]
  if (head === undefined || !head.startsWith('## ')) {
    return undefined
  }
  const raw = head.slice(3)
  const branch = raw.startsWith('No commits yet on ')
    ? raw.slice('No commits yet on '.length)
    : (raw.split('...')[0] ?? '').split(' ')[0] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(raw)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(raw)?.[1] ?? 0)

  return { branch, ahead, behind, dirty: lines.length - 1 }
}

/** Runs one part of the line; a part that fails is left out. */
async function part(parts: string[], build: () => Promise<string[]>): Promise<void> {
  try {
    parts.push(...(await build()))
  } catch {
    // Left out this time; the next refresh tries again.
  }
}

async function refresh($: EngineInterface): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return
  }
  refreshing = true
  try {
    do {
      refreshAgain = false
      const parts: string[] = []

      // The folder's name always shows, so the line is never empty.
      await part(parts, async () => {
        const folder = (await $.session.cwd()).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
        return folder === '' ? [] : [`▸ ${folder}`]
      })

      if (lastTurn !== undefined) {
        parts.push(`⏱ ${duration(lastTurn.ms)} · ${lastTurn.tools} tools`)
      }

      await part(parts, async () => {
        const usage = await $.session.usage()
        const out: string[] = []
        if (usage.cost !== undefined && usage.cost.usd > 0) {
          out.push(`$${usage.cost.usd.toFixed(2)}`)
        }
        const pct = usage.context.percent
        if (pct !== undefined && pct >= 60) {
          out.push(`context ${pct}%${pct >= 85 ? ' ‼' : pct >= 70 ? ' ⚠' : ''}`)
        }
        for (const limit of usage.rateLimits) {
          if (limit.kind === 'five_hour' && limit.percentUsed >= 50) {
            const at = limit.resetsAt === undefined ? '' : ` (resets ${new Date(limit.resetsAt).toTimeString().slice(0, 5)})`
            out.push(`5h limit ${Math.round(limit.percentUsed)}%${at}`)
          }
        }
        return out
      })

      await part(parts, async () => {
        const live = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
        return live.length === 0 ? [] : [`${live.length} agent${live.length === 1 ? '' : 's'} running`]
      })

      // --no-optional-locks: the status check never takes git's index lock, so it can't
      // make your own `git commit` or `git rebase` fail with "index.lock exists".
      await part(parts, async () => {
        const git = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 5000 })
        const info = git.exitCode === 0 ? parseGit(git.stdout) : undefined
        if (info === undefined) {
          return []
        }
        let line = `⎇ ${info.branch}`
        if (info.ahead > 0) {
          line += ` ↑${info.ahead}`
        }
        if (info.behind > 0) {
          line += ` ↓${info.behind}`
        }
        if (info.dirty > 0) {
          line += ` · ✎ ${info.dirty}`
        }
        return [line]
      })

      // Pinned under the prompt; the terminal, desktop and mobile apps all draw it.
      const line = parts.join('  ·  ')
      $.ui.status(line === '' ? undefined : line)
    } while (refreshAgain)
  } finally {
    refreshing = false
  }
}

/** Refreshes in the background, so a slow git or usage check never holds up the session. */
function refreshSoon($: EngineInterface): void {
  void refresh($).catch(() => undefined)
}

// ---- sound -----------------------------------------------------------------------

let quietUntil = 0
function announce($: EngineInterface, file: string): void {
  const now = Date.now()
  if (now < quietUntil) {
    return
  }
  quietUntil = now + QUIET_MS
  try {
    // Your own recording first; when there is none, the one shipped with the mod.
    void $.audio
      .play({ asset: `sounds-local/${file}` }, { gain: 0.9 })
      .catch(() => $.audio.play({ asset: `sounds/${file}` }, { gain: 0.9 }))
      .catch(() => undefined)
  } catch {
    // No player here: stay silent.
  }
}

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : undefined
}

/** Tool calls where Claude asks you a question or puts choices in front of you. */
function asksYou(tool: string, args: unknown): boolean {
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') {
    return true
  }
  // The end-of-turn box, when it comes with a question and buttons.
  if (tool === 'WrapUp' || tool === 'mcp__ccd_turn__wrap_up') {
    const ask = field(args, 'ask')

    return ask !== undefined && ask.trim() !== ''
  }

  return false
}

// ---- hooks -----------------------------------------------------------------------

/** Once per session: starts the status line's timer, then fills the line in the background. */
export function startSessionTools($: EngineInterface): void {
  lastTurn = undefined
  try {
    $.clock.every(REFRESH_MS, () => refreshSoon($))
  } catch {
    // No timer: the line still updates after each turn.
  }
  refreshSoon($)
}

export function registerSessionTools(on: On): void {
  // Marks a prompt you typed; slash commands and prompts from elsewhere don't count.
  on('prompt.submit', ($, e, next) => {
    if (YOUR_PROMPTS.has(e.origin.kind) && e.command === undefined && e.isMeta !== true) {
      promptPending = true
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      userTurn = promptPending
      promptPending = false
      turnTools = 0
      askedThisTurn = false
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Counts tool calls and announces questions. If it fails, the call goes on untouched.
  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) {
      turnTools += 1
    }
    if (asksYou(e.tool, e)) {
      askedThisTurn = true
      announce($, SOUND_QUESTION)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // "Task complete" plays only when a long turn you started ends with an answer: not for
  // subagents, failed or stopped turns, or a turn that ended on a question you just heard.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      lastTurn = { ms: e.durationMs, tools: turnTools }
      if (userTurn && !askedThisTurn && e.reason === 'answer' && !e.isAborted && e.durationMs >= DONE_SOUND_AFTER_MS) {
        announce($, SOUND_DONE)
      }
      userTurn = false
      askedThisTurn = false
      refreshSoon($)
    }

    return done
  })

  // The guards put anything dangerous to you: an "allow" from your rules, or an "ask" the auto-mode
  // classifier would settle on its own, becomes this mod's ask, which only a person can answer.
  // Where nobody can be asked (a `claude -p` run, a background subagent) that ask is a refusal.
  on('tool.check', async ($, e, next) => {
    const why = concern(e.tool, e.input, e.isReadOnly === true)
    const verdict = await next(e)
    if (why === undefined || verdict.decision === 'deny' || (verdict.decision === 'ask' && verdict.plugin !== undefined)) {
      return verdict
    }
    if (e.tool_use_id !== undefined && e.approver === 'person') {
      announce($, SOUND_APPROVE)
    }

    return { decision: 'ask', reason: why }
  }).catch(async ($, e, next) => {
    // A guard that fails asks rather than allows, and never loosens a refusal from beneath.
    const ask = { decision: 'ask', reason: 'Guard: the check failed. Asking for your approval.' } as const
    if (next.called) {
      return ask
    }
    const verdict = await next(e)

    return verdict.decision === 'deny' ? verdict : ask
  })
}
