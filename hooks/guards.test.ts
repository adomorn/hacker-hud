import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// The test runtime has timers; the engine's typings, written for mods, leave them out.
declare const setTimeout: (callback: () => void, ms: number) => unknown

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

test('a recording in sounds-local wins, the shipped one plays when there is none', async ($, on) => {
  const played: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('audio.play', (_, e) => {
    const clip = e.clip as { asset?: string }
    const asset = clip.asset ?? ''
    played.push(asset)
    if (asset.startsWith('sounds-local/')) {
      throw new Error('no such file')
    }

    return { value: undefined }
  })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
  expect(played).toEqual(['sounds-local/question-voice.mp3', 'sounds/question-voice.mp3'])
})

/** Plays a turn you started by typing: it begins, makes the given tool calls, and ends after `durationMs`. */
async function playTurn(
  $: Engine,
  calls: Record<string, unknown>[],
  durationMs: number,
): Promise<void> {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  for (const call of calls) {
    await $.tool.call(call as never)
  }
  // Past the 2-second gap between announcements, so only the rule under test can hold one back.
  await new Promise<void>(resolve => setTimeout(resolve, 2100))
  await $.turn.complete({ answer: 'done', durationMs, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

test('a long turn you started announces "Task complete"', async ($, on) => {
  const played: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('audio.play', (_, e) => {
    played.push((e.clip as { asset?: string }).asset ?? '')

    return { value: undefined }
  })
  await playTurn($, [], 45_000)
  expect(played).toEqual(['sounds-local/done-voice.mp3'])
})

test('a long turn that ends on a question announces only the question', async ($, on) => {
  const played: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('audio.play', (_, e) => {
    played.push((e.clip as { asset?: string }).asset ?? '')

    return { value: undefined }
  })
  await playTurn($, [{ tool: 'mcp__ccd_turn__wrap_up', recap: 'done', ask: 'Push it?' }], 45_000)
  expect(played).toEqual(['sounds-local/question-voice.mp3'])
})
