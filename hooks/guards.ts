// What the guards look for: destructive shell commands, and text that looks like a secret.
// Commands are read word by word, the way a shell splits them, so a pattern inside quotes
// (`grep "rm -rf"`, a commit message) is not mistaken for the command itself. Both checks are a
// safety net, not a sandbox: a command built at run time (`$cmd -rf`) is not seen.

/** A shell command split into simple commands, each a list of words with quotes removed. */
export function splitCommand(text: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let quote: '"' | "'" | undefined

  const endWord = (): void => {
    if (inWord) {
      words.push(word)
    }
    word = ''
    inWord = false
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
    }
    words = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quote !== undefined) {
      if (c === quote) {
        quote = undefined
      } else if (c === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1
        word += text[i]
      } else {
        word += c
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < text.length) {
      i += 1
      if (text[i] !== '\n') {
        word += text[i]
        inWord = true
      }
    } else if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')' || c === '`') {
      endCommand()
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endCommand()

  return commands
}

// Words that run the command after them: `sudo rm -rf x` is an `rm`.
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'time', 'nice', 'ionice', 'command', 'exec', 'xargs', 'timeout', 'stdbuf'])
// Options of those wrappers that take a value, so the value is not read as the command.
const WRAPPER_VALUES = new Set(['-u', '-g', '-n', '-c', '-s', '-k', '-I', '-L', '-P', '-d', '-E', '-o', '-i', '-e'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])

function commandName(word: string): string {
  return (word.split('/').pop() ?? word).replace(/^\\/, '')
}

/** The command a list of words runs, with wrappers and leading `VAR=value` assignments removed. */
function unwrap(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    const w = words[i] as string
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i += 1
      continue
    }
    const name = commandName(w)
    if (!WRAPPERS.has(name)) {
      break
    }
    i += 1
    if (name === 'timeout' && i < words.length && /^\d/.test(words[i] as string)) {
      i += 1
    }
    while (i < words.length && (words[i] as string).startsWith('-')) {
      const option = words[i] as string
      i += 1
      if (WRAPPER_VALUES.has(option)) {
        i += 1
      }
    }
  }

  return words.slice(i)
}

function shortFlags(args: string[]): string {
  return args.filter(a => /^-[A-Za-z]/.test(a)).map(a => a.slice(1)).join('')
}

// Git's own options that come before the subcommand and take a value.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
const WHOLE_TREE = new Set(['.', ':/', '*', ':(top)'])

function gitConcern(args: string[]): string | undefined {
  let i = 0
  while (i < args.length && (args[i] as string).startsWith('-')) {
    i += GIT_VALUE_OPTIONS.has(args[i] as string) ? 2 : 1
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  const options = rest.filter(a => a.startsWith('-'))
  const flags = shortFlags(rest)

  switch (sub) {
    case 'push': {
      const forced = options.some(o => o === '--force' || o === '--mirror' || o === '--delete' || o === '--prune') ||
        /[fd]/.test(flags) ||
        rest.some(a => !a.startsWith('-') && (a.startsWith('+') || (a.startsWith(':') && a.length > 1)))
      return forced ? 'git push --force, --mirror, --delete or a +/: refspec rewrites or deletes remote branches' : undefined
    }
    case 'reset':
      return options.includes('--hard') ? 'git reset --hard discards uncommitted changes' : undefined
    case 'clean': {
      const force = options.includes('--force') || flags.includes('f')
      const dryRun = options.includes('--dry-run') || flags.includes('n')
      return force && !dryRun ? 'git clean -f deletes untracked files' : undefined
    }
    case 'checkout':
    case 'restore': {
      const stagedOnly = sub === 'restore' && (options.includes('--staged') || flags.includes('S')) &&
        !options.includes('--worktree') && !flags.includes('W')
      const wholeTree = rest.some(a => WHOLE_TREE.has(a))
      const forced = sub === 'checkout' && (options.includes('--force') || flags.includes('f'))
      return !stagedOnly && (wholeTree || forced) ? `git ${sub} discards every uncommitted change in the working tree` : undefined
    }
    case 'stash':
      return rest[0] === 'clear' || rest[0] === 'drop' ? `git stash ${rest[0]} deletes stashed changes for good` : undefined
    case 'branch': {
      const forceDelete = flags.includes('D') ||
        ((options.includes('--delete') || flags.includes('d')) && (options.includes('--force') || flags.includes('f')))
      return forceDelete ? 'git branch -D deletes a branch even if it is not merged' : undefined
    }
    default:
      return undefined
  }
}

const SQL_CLIENTS = new Set([
  'psql', 'pgcli', 'mysql', 'mariadb', 'mycli', 'sqlcmd', 'osql', 'isql', 'sqlite3', 'litecli',
  'duckdb', 'clickhouse', 'clickhouse-client', 'cockroach', 'snowsql', 'bq', 'usql', 'mongosh',
])

/** SQL that drops or empties a table, read statement by statement so a WHERE on the next line counts. */
export function sqlConcern(text: string): string | undefined {
  for (const statement of text.split(';')) {
    if (/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE)\b/i.test(statement)) {
      return 'this SQL drops or empties a table or a database'
    }
    if (/\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) {
      return 'DELETE without WHERE removes every row'
    }
    if (/\bdropDatabase\s*\(|\.drop\s*\(\s*\)|\.deleteMany\s*\(\s*\{\s*\}\s*\)/.test(statement)) {
      return 'this drops a collection or a database, or deletes every document'
    }
  }

  return undefined
}

function simpleConcern(words: string[], depth: number): string | undefined {
  const [first, ...args] = unwrap(words)
  if (first === undefined) {
    return undefined
  }
  const name = commandName(first)
  const lower = name.toLowerCase()

  // `bash -c "rm -rf x"` and `eval "..."`: the inner command is read too.
  if (SHELLS.has(name)) {
    const at = args.findIndex(a => /^-[A-Za-z]*c[A-Za-z]*$/.test(a))
    const inner = at === -1 ? undefined : args[at + 1]
    return inner !== undefined && depth < 3 ? commandConcern(inner, depth + 1) : undefined
  }
  if (name === 'eval') {
    return depth < 3 ? commandConcern(args.join(' '), depth + 1) : undefined
  }
  if (name === 'rm') {
    const end = args.indexOf('--')
    const options = end === -1 ? args : args.slice(0, end)
    const recursive = options.includes('--recursive') || /[rR]/.test(shortFlags(options))
    return recursive ? 'rm -r deletes a folder and everything in it for good' : undefined
  }
  if (name === 'find') {
    return args.includes('-delete') || args.some((a, i) => (a === '-exec' || a === '-execdir') && commandName(args[i + 1] ?? '') === 'rm')
      ? 'find -delete removes every file it matches'
      : undefined
  }
  if (name === 'git') {
    return gitConcern(args)
  }
  if (name === 'dropdb') {
    return 'dropdb deletes a database'
  }
  if (name === 'dotnet' && args[0] === 'ef' && args[1] === 'database') {
    if (args[2] === 'drop') {
      return 'dotnet ef database drop deletes the database'
    }
    if (args[2] === 'update' && args[3] === '0') {
      return 'dotnet ef database update 0 reverts every migration'
    }
  }
  // PowerShell and cmd: Remove-Item -Recurse, rd /s, del /s.
  if (['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(lower)) {
    const recursive = args.some(a => /^-rec?u?r?s?e?$/i.test(a) || /^\/s$/i.test(a))
    return recursive ? `${name} with -Recurse or /s deletes a folder and everything in it` : undefined
  }

  return undefined
}

/** Why a shell command needs your approval; undefined when it doesn't. */
export function commandConcern(command: string, depth = 0): string | undefined {
  const commands = splitCommand(command)
  for (const words of commands) {
    const hit = simpleConcern(words, depth)
    if (hit !== undefined) {
      return hit
    }
  }
  // SQL is read only when a database client runs, so a grep or a commit message that mentions it passes.
  if (commands.some(words => SQL_CLIENTS.has(commandName(unwrap(words)[0] ?? '')))) {
    return sqlConcern(command)
  }

  return undefined
}

// ---- secrets -----------------------------------------------------------------

const SECRETS: { pattern: RegExp; what: string }[] = [
  { pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/, what: 'a private key' },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, what: 'an AWS access key' },
  { pattern: /\baws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+]{40}\b/i, what: 'an AWS secret key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, what: 'a GitHub token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, what: 'a GitHub token' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/, what: 'a GitLab token' },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{48}\b/, what: 'an OpenAI API key' },
  { pattern: /\bxox[abeprs]-[A-Za-z0-9-]{10,}|\bxapp-\d-[A-Za-z0-9-]{10,}/, what: 'a Slack token' },
  { pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/, what: 'a Slack webhook URL' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'a Google API key' },
  { pattern: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b|\bwhsec_[0-9a-zA-Z]{24,}\b/, what: 'a live Stripe key' },
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/, what: 'an npm token' },
  { pattern: /\bpypi-[A-Za-z0-9_-]{50,}/, what: 'a PyPI token' },
  { pattern: /\bhf_[A-Za-z0-9]{30,}\b/, what: 'a Hugging Face token' },
  { pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, what: 'a SendGrid key' },
  { pattern: /\bAccountKey=[A-Za-z0-9/+]{40,}={0,2}/, what: 'an Azure storage key' },
  { pattern: /\b(?:Password|Pwd)\s*=\s*(?!["']?(?:\$|\{|<|%|\*{3}))[^;"'\s]{4,}(?=\s*(?:;|"|'|$))/im, what: 'a password in a connection string' },
  { pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,100}:(?!\$|\{|<|%|\*{3})[^\s@/]{3,100}@[\w.-]/i, what: 'a password in a URL' },
]

/** Values that only look like a key: documentation examples and placeholders. */
function isPlaceholder(match: string): boolean {
  return /EXAMPLE|example|placeholder|your[_-]?|xxxx|XXXX|\.\.\./.test(match) || /(.)\1{11,}/.test(match)
}

/** What kind of secret the text seems to hold, or undefined. */
export function secretIn(text: string): string | undefined {
  for (const { pattern, what } of SECRETS) {
    const match = pattern.exec(text)
    if (match !== null && !isPlaceholder(match[0])) {
      return what
    }
  }

  return undefined
}

// The fields of a tool's input that carry new text: what a write, an edit or a message would send.
const TEXT_FIELDS = ['content', 'new_string', 'new_source', 'text', 'body', 'message', 'command']

/** The new text a tool call would write or send, gathered from its input. */
export function outgoingText(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const record = input as Record<string, unknown>
  const parts: string[] = []
  for (const key of TEXT_FIELDS) {
    const value = record[key]
    if (typeof value === 'string') {
      parts.push(value)
    }
  }
  const edits = record.edits
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (typeof edit === 'object' && edit !== null && typeof (edit as Record<string, unknown>).new_string === 'string') {
        parts.push((edit as Record<string, unknown>).new_string as string)
      }
    }
  }

  return parts.join('\n')
}

/** Why a tool call needs your approval; undefined when it doesn't. */
export function concern(tool: string, input: unknown, isReadOnly: boolean): string | undefined {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).command : undefined
    if (typeof command === 'string') {
      const why = commandConcern(command)
      if (why !== undefined) {
        return `Guard: ${why}. Asking for your approval before it runs.`
      }
    }
  }
  if (isReadOnly) {
    return undefined
  }
  const what = secretIn(outgoingText(input))

  return what === undefined
    ? undefined
    : `Guard: this call would write or send what looks like ${what}. Asking for your approval first.`
}
