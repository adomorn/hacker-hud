import { expect, test } from 'claude-code/testing'

// The engine below the mod allows everything, so every "ask" comes from the guards.

// A made-up AWS-style key, assembled at run time so the file itself holds no key-shaped text.
const FAKE_AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP'

test('dangerous shell commands are put to the person', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('audio.play', () => ({ value: undefined }))
  for (const command of [
    'git push --force origin main',
    'git push -f',
    'git reset --hard HEAD~3',
    'rm -rf build',
    'psql -c "DROP TABLE users"',
    'sqlcmd -Q "DELETE FROM Orders"',
    'dotnet ef database drop --force',
  ]) {
    const verdict = await $.tool.check({ tool: 'Bash', input: { command }, tool_use_id: 't1' })
    expect(verdict.decision).toBe('ask')
  }
})

test('everyday commands pass untouched', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('audio.play', () => ({ value: undefined }))
  for (const command of [
    'git push origin feature/x',
    'git push --force-with-lease',
    'rm build/out.txt',
    'dotnet test',
    'sqlcmd -Q "DELETE FROM Orders WHERE Id = 4"',
  ]) {
    const verdict = await $.tool.check({ tool: 'Bash', input: { command }, tool_use_id: 't2' })
    expect(verdict.decision).toBe('allow')
  }
})

test('writing something that looks like a key is put to the person', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('audio.play', () => ({ value: undefined }))
  const leaked = await $.tool.check({
    tool: 'Write',
    input: { file_path: 'appsettings.json', content: `{ "Aws": { "Key": "${FAKE_AWS_KEY}" } }` },
    tool_use_id: 't3',
  })
  expect(leaked.decision).toBe('ask')

  const clean = await $.tool.check({
    tool: 'Edit',
    input: { file_path: 'Program.cs', old_string: 'a', new_string: 'var key = config["Aws:Key"];' },
    tool_use_id: 't4',
  })
  expect(clean.decision).toBe('allow')
})

test('a deny from below stays a deny', async ($, on) => {
  on('tool.check', () => ({ decision: 'deny', reason: 'rule' }))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, tool_use_id: 't5' })
  expect(verdict.decision).toBe('deny')
})

test('an ask the auto classifier settles plays no sound', async ($, on) => {
  let plays = 0
  on('tool.check', () => ({ decision: 'ask' }))
  on('audio.play', () => {
    plays += 1

    return { value: undefined }
  })
  for (let i = 0; i < 5; i++) {
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: `t${i}`, approver: 'person' })
  }
  expect(plays).toBe(0)
})

test('a question with choices is announced once', async ($, on) => {
  let plays = 0
  on('tool.call', () => ({ result: {} }))
  on('audio.play', () => {
    plays += 1

    return { value: undefined }
  })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  expect(plays).toBe(1)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' })
  expect(plays).toBe(1)
})
