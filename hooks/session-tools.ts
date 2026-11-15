// Tools that run in every session: a status line under the prompt, a guard for
// destructive commands, a secret-leak check, and spoken announcements.
// Rule of thumb: a piece shows only when it has something worth showing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

// Spoken announcements, generated once and shipped with the mod.
const SOUND_DONE = 'sounds/done-voice.mp3' // "Task complete."
const SOUND_APPROVE = 'sounds/approve-voice.mp3' // "Your approval is needed."
const SOUND_QUESTION = 'sounds/question-voice.mp3' // "I have a question for you."
const REFRESH_MS = 20_000
const DONE_SOUND_AFTER_MS = 30_000

// ---- status line -----------------------------------------------------------

// Drawn into the hint line under the prompt; writing the atom redraws that line.
export const statusLine = atom({ plugin: 'hacker-hud', key: 'line' } as const, '')

let turnTools = 0
let userTurn = false
let lastTurn: { ms: number; tools: number } | undefined
let refreshing = false

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)

  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Reads `## main...origin/main [ahead 2, behind 5]` and counts the changed files. */
function parseGit(stdout: string): { branch: string; ahead: number; behind: number; dirty: number } | undefined {
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

async function refresh($: EngineInterface): Promise<void> {
  if (refreshing) {
    return
  }
  refreshing = true
  try {
    const parts: string[] = []

    if (lastTurn !== undefined) {
      parts.push(`⏱ ${duration(lastTurn.ms)} · ${lastTurn.tools} tools`)
    }

    const usage = await $.session.usage()
    if (usage.cost !== undefined && usage.cost.usd > 0) {
      parts.push(`$${usage.cost.usd.toFixed(2)}`)
    }
    const pct = usage.context.percent
    if (pct !== undefined && pct >= 60) {
      parts.push(`context ${pct}%${pct >= 85 ? ' ‼' : pct >= 70 ? ' ⚠' : ''}`)
    }
    for (const limit of usage.rateLimits) {
      if (limit.kind === 'five_hour' && limit.percentUsed >= 50) {
        const at = limit.resetsAt === undefined ? '' : ` (resets ${new Date(limit.resetsAt).toTimeString().slice(0, 5)})`
        parts.push(`5h limit ${Math.round(limit.percentUsed)}%${at}`)
      }
    }

    const agents = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending')
    if (agents.length > 0) {
      parts.push(`${agents.length} agent${agents.length === 1 ? '' : 's'} running`)
    }

    try {
      const git = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 5000 })
      const info = git.exitCode === 0 ? parseGit(git.stdout) : undefined
      if (info !== undefined) {
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
        parts.push(line)
      }
    } catch {
      // No git, or not a repository: the git part stays hidden.
    }

    const line = parts.join('  ·  ')
    await update($, statusLine, () => line)
  } finally {
    refreshing = false
  }
}

// ---- guards ----------------------------------------------------------------

const DANGEROUS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bgit\s+push\b[^\n;&|]*\s(--force(?!-with-lease)\b|-f\b)/, why: 'git push --force rewrites the remote branch history' },
  { pattern: /\bgit\s+reset\s+[^\n;&|]*--hard\b/, why: 'git reset --hard discards uncommitted changes' },
  { pattern: /\bgit\s+clean\s+[^\n;&|]*-[a-zA-Z]*f/, why: 'git clean -f deletes untracked files' },
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b/, why: 'rm -rf deletes files for good' },
  { pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, why: 'this SQL drops a table or a database' },
  { pattern: /\bDELETE\s+FROM\s+[\w."[\]]+\s*(;|$|["'`])/im, why: 'DELETE without WHERE removes every row' },
  { pattern: /\bdotnet\s+ef\s+database\s+drop\b/, why: 'dotnet ef database drop deletes the database' },
]

const SECRETS: { pattern: RegExp; what: string }[] = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key (PEM)' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, what: 'a GitHub token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, what: 'a GitHub token' },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{40,}/, what: 'an OpenAI API key' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, what: 'a Slack token' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'a Google API key' },
  { pattern: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b/, what: 'a live Stripe key' },
]

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : undefined
}

/** Why a command or the text about to be written needs your approval; undefined when it doesn't. */
function concern(tool: string, input: unknown): string | undefined {
  if (tool === 'Bash') {
    const command = field(input, 'command') ?? ''
    const hit = DANGEROUS.find(d => d.pattern.test(command))

    return hit === undefined ? undefined : `Guard: ${hit.why}. Asking for your approval before it runs.`
  }

  let text = ''
  if (tool === 'Write') {
    text = field(input, 'content') ?? ''
  } else if (tool === 'Edit') {
    text = field(input, 'new_string') ?? ''
  } else if (tool === 'MultiEdit') {
    const edits = (input as { edits?: unknown }).edits
    if (Array.isArray(edits)) {
      text = edits.map(edit => field(edit, 'new_string') ?? '').join('\n')
    }
  } else if (tool === 'NotebookEdit') {
    text = field(input, 'new_source') ?? ''
  } else {
    return undefined
  }
  const hit = SECRETS.find(s => s.pattern.test(text))

  return hit === undefined
    ? undefined
    : `Guard: the text about to be written contains what looks like ${hit.what}. Asking for your approval before it is saved.`
}

// ---- sound -----------------------------------------------------------------

// Announcements never overlap: a second one within 2 seconds of the last is skipped.
let lastAnnouncedAt = 0
function announce($: EngineInterface, asset: string): void {
  const now = Date.now()
  if (now - lastAnnouncedAt < 2000) {
    return
  }
  lastAnnouncedAt = now
  void $.audio.play({ asset }, { gain: 0.9 }).catch(() => undefined)
}

/** Tool calls where Claude asks you a question or puts choices in front of you. */
function asksYou(tool: string, args: unknown): boolean {
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') {
    return true
  }
  // The desktop app's end-of-turn box, when it comes with a question and buttons.
  if (tool === 'mcp__ccd_turn__wrap_up') {
    const ask = field(args, 'ask')

    return ask !== undefined && ask.trim() !== ''
  }

  return false
}

// ---- hooks -----------------------------------------------------------------

/** Once per session: fills the status line and starts its refresh timer. */
export async function startSessionTools($: EngineInterface): Promise<void> {
  await refresh($)
  $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
}

export function registerSessionTools(on: On): void {
  // The hint line under the prompt: the terminal draws `tail`; on desktop the hint text itself is extended.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = await read($, statusLine)
    if (line === '') {
      return next(e)
    }
    if (e.surface === 'terminal') {
      return next({ ...e, props: { ...e.props, tail: `  ${line}` } })
    }
    const hint = e.props.hint === '' ? line : `${e.props.hint}   ·   ${line}`

    return next({ ...e, props: { ...e.props, hint } })
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      turnTools = 0
    }

    return next(e)
  })

  // Counts tool calls and announces questions. If it fails, the call goes on untouched.
  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) {
      turnTools += 1
    }
    if (asksYou(e.tool, e)) {
      announce($, SOUND_QUESTION)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Marks a turn you started by typing; turns started by notifications or timers don't count.
  on('prompt.submit', ($, e, next) => {
    userTurn = true

    return next(e)
  }).catch(($, e, next) => next(e))

  // "Task complete" is announced only for long turns you started, so it reaches you after you've looked away.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      lastTurn = { ms: e.durationMs, tools: turnTools }
      if (userTurn && !e.isAborted && e.durationMs >= DONE_SOUND_AFTER_MS) {
        announce($, SOUND_DONE)
      }
      userTurn = false
      await refresh($)
    }

    return done
  })

  // The guards read the engine's verdict and turn an "allow" into an "ask" for anything dangerous.
  // That "ask" always opens a dialog, so the approval announcement plays here. Claude Code's own
  // permission-request event also fires for calls auto mode approves silently, so it is not used.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'allow') {
      return verdict
    }
    const why = concern(e.tool, e.input)
    if (why === undefined) {
      return verdict
    }
    if (e.tool_use_id !== undefined) {
      announce($, SOUND_APPROVE)
    }

    return { decision: 'ask', reason: why }
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'ask', reason: 'Guard: the check failed. Asking for your approval.' }))
}
