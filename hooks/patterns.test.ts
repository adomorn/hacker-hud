import { expect, test } from 'claude-code/testing'

import { commandConcern, concern, secretIn } from './guards'
import { parseGit } from './session-tools'

// Every command here must be put to you.
const DANGEROUS = [
  // rm, any spelling of a recursive delete
  'rm -rf build', 'rm -Rf build', 'rm -rF build', 'rm -rfv build', 'rm -vrf build', 'rm -r build',
  'rm -r -v -f build', 'rm -d -r -f build', 'rm --recursive --force build', 'sudo rm -rf /var/app',
  '/bin/rm -rf build', '\\rm -rf build', "r''m -rf build", 'cd app && rm -rf dist', 'ls | xargs rm -rf',
  'FOO=1 rm -rf build', 'bash -c "rm -rf build"', 'bash -lc \'rm -rf build\'', 'eval "rm -rf build"',
  'find . -name "*.tmp" -delete', 'find . -exec rm {} \\;',
  // git push
  'git push --force origin main', 'git push -f', 'git push -uf origin main', 'git push -fu origin main',
  'git push origin +main', 'git push origin +HEAD:main', 'git push --mirror', 'git push origin --delete main',
  'git push origin :main', 'git -C repo push --force', 'git -c core.x=y push -f',
  // other git
  'git reset --hard HEAD~3', 'git -C app reset --hard HEAD~3', 'git clean -fd', 'git -C app clean -fd',
  'git clean --force', 'git checkout -- .', 'git checkout .', 'git restore .', 'git stash clear',
  'git stash drop', 'git branch -D main', 'git branch --delete --force main',
  // SQL, through a database client
  'psql -c "DROP TABLE users"', 'psql -c "TRUNCATE users"', 'psql -c "DELETE FROM users u"',
  'mysql -e "DELETE FROM `users`"', 'mysql -e "DELETE FROM users LIMIT 1000"',
  'psql -c "DELETE FROM users RETURNING *"', 'sqlite3 a.db "DELETE FROM t -- all"',
  'psql -c "delete from \\"Users\\""', 'sqlcmd -Q "DELETE FROM Orders"', 'psql -c "DROP DATABASE prod"',
  "psql <<'SQL'\nDELETE FROM orders;\nSQL",
  // databases from the command line
  'dropdb prod', 'dotnet ef database drop --force', 'dotnet ef database update 0',
  // PowerShell and cmd
  'Remove-Item -Recurse -Force C:\\app', 'rm -Recurse -Force build', 'rd /s /q build',
]

// Everyday commands that must pass untouched.
const SAFE = [
  'git push origin feature/x', 'git push --force-with-lease', 'git push --force-with-lease --force-if-includes',
  'git push --force-if-includes', 'git push -u origin main', 'git reset HEAD file.txt', 'git reset --soft HEAD~1',
  'git clean -n', 'git clean -n -e build-files', 'git clean -fn', 'git checkout -b feature/x', 'git checkout main',
  'git checkout -- src/app.ts', 'git restore --staged .', 'git stash', 'git stash pop', 'git branch -d merged',
  'rm build/out.txt', 'rm -f build/out.txt', 'dotnet test', 'npm run clean', 'git rm -r --cached build',
  'grep -rn "rm -rf" scripts/', 'git commit -m "stop using rm -rf in CI"', 'echo "never run rm -rf /"',
  'grep -rn "DROP TABLE" migrations/', 'git log --grep="DROP TABLE"', 'rg -n "git reset --hard" docs/',
  'sqlcmd -Q "DELETE FROM Orders WHERE Id = 4"', "psql <<'SQL'\nDELETE FROM orders\nWHERE id = 4;\nSQL",
  'psql -c "DELETE FROM orders\nWHERE id = 4"', 'psql -c "SELECT * FROM users"', 'find . -name "*.ts"',
  'dotnet ef database update', 'echo DELETE FROM users',
]

test('destructive commands are caught, however they are spelled', () => {
  const missed = DANGEROUS.filter(c => commandConcern(c) === undefined)
  expect(missed).toEqual([])
})

test('everyday commands pass', () => {
  const caught = SAFE.filter(c => commandConcern(c) !== undefined).map(c => `${c} -> ${commandConcern(c)}`)
  expect(caught).toEqual([])
})

// Fake keys, assembled at run time so the file itself holds no key-shaped text.
const k = (...parts: string[]): string => parts.join('')
const SECRETS = [
  k('-----BEGIN ', 'PGP PRIVATE KEY BLOCK-----'), k('-----BEGIN ', 'RSA PRIVATE KEY-----'), k('-----BEGIN ', 'OPENSSH PRIVATE KEY-----'),
  k('AKIA', 'Q3ZK7M2P9R4T6W8Y'), k('ASIA', 'Q3ZK7M2P9R4T6W8Y'), k('aws_secret_access_key = ', 'wJalrXUtnFEMIK7MDENGbPxRfiCYzQ3ZK7M2P9R4'),
  k('ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'), k('glpat-', 'a1B2c3D4e5F6g7H8i9J0'),
  k('sk-ant-', 'api03-a1B2c3D4e5F6g7H8i9J0k1L2'), k('sk-proj-', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'),
  k('xoxb-', '1234567890-abcdefghij'), k('xapp-', '1-A1B2C3D4E5-1234567890'),
  k('https://hooks.slack.com/services/', 'T0A1B2C3D/B0A1B2C3D/a1B2c3D4e5F6g7H8'),
  k('AIza', 'Sy1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7'), k('sk_live_', 'a1B2c3D4e5F6g7H8i9J0k1L2'), k('whsec_', 'a1B2c3D4e5F6g7H8i9J0k1L2'),
  k('npm_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'), k('hf_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5'),
  k('SG.', 'a1B2c3D4e5F6g7H8i9J0k1', '.', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V'),
  k('DefaultEndpointsProtocol=https;AccountName=app;', 'AccountKey=a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2==;'),
  k('Server=db;Database=app;User Id=sa;', 'Password=Hunter2!;'),
  k('postgres://admin:', 'S3cretPass@db/app'),
]

const NOT_SECRETS = [
  k('AKIA', 'IOSFODNN7EXAMPLE'), k('ghp_', 'x'.repeat(36)),
  'class="sk-skeleton-loader-container-with-very-long-modifier-name"',
  'Password=${DB_PASSWORD};', 'Password={password};', 'postgres://admin:${PGPASS}@db/app',
  'var key = config["Aws:Key"];', 'https://example.com/path', 'git@github.com:org/repo.git',
]

test('secrets are recognized', () => {
  const missed = SECRETS.filter(s => secretIn(s) === undefined)
  expect(missed).toEqual([])
})

test('placeholders and lookalikes are not secrets', () => {
  const caught = NOT_SECRETS.filter(s => secretIn(s) !== undefined).map(s => `${s} -> ${secretIn(s)}`)
  expect(caught).toEqual([])
})

test('secrets are caught in shell commands, edits and messages, not in reads', () => {
  const key = k('AKIA', 'Q3ZK7M2P9R4T6W8Y')
  expect(concern('Bash', { command: `echo "aws_access_key_id=${key}" >> ~/.aws/credentials` }, false)).toBeDefined()
  expect(concern('MultiEdit', { edits: [{ old_string: 'a', new_string: key }] }, false)).toBeDefined()
  expect(concern('mcp__slack__send_message', { channel: 'x', text: `here: ${key}` }, false)).toBeDefined()
  // Removing a leaked key is not writing one.
  expect(concern('Edit', { old_string: key, new_string: 'config["Aws:Key"]' }, false)).toBeUndefined()
  expect(concern('Grep', { pattern: key, text: key }, true)).toBeUndefined()
  expect(concern('MultiEdit', null, false)).toBeUndefined()
})

test('long input is checked quickly', () => {
  const started = Date.now()
  commandConcern('git push '.repeat(20000))
  commandConcern('git reset '.repeat(20000))
  secretIn('a://b:'.repeat(50000))
  expect(Date.now() - started).toBeLessThan(500)
})

test('git status is read into branch, ahead, behind and changed files', () => {
  expect(parseGit('## main...origin/main [ahead 2, behind 5]\n M a.ts\n?? b.ts\n')).toEqual({ branch: 'main', ahead: 2, behind: 5, dirty: 2 })
  expect(parseGit('## No commits yet on main\n')).toEqual({ branch: 'main', ahead: 0, behind: 0, dirty: 0 })
  expect(parseGit('fatal: not a git repository')).toBeUndefined()
})
