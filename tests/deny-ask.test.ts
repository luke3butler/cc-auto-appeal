import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMMAND = 'git push --force origin main'
const CLASSIFIER_DENIAL =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Force-pushes to main. If you have other tasks that don\'t depend on this action, continue working on those.'

// Stands for core in auto mode: `verdict` is what the rules decide, and on
// `ask` the decider (`denial`, the classifier's or the dialog's) refuses the
// first call. A retry here comes from the test's own `$`, so it cannot carry
// the plugin's origin: it simply runs. `answer` is what the person picks in
// the AskUserQuestion dialog, or undefined when they dismiss it.
function engine($: Engine, on: On, verdict: 'ask' | 'deny', answer?: string, denial = CLASSIFIER_DENIAL) {
  const seen = { runs: 0, refusals: 0, questions: [] as string[] }

  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const question = e.questions[0]?.question ?? ''
    seen.questions.push(question)
    return { result: { questions: e.questions, answers: answer === undefined ? {} : { [question]: answer } } }
  })

  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    const input = { command: e.command }
    const { decision } = await $.tool.check({ tool: 'Bash', input, tool_use_id: e.tool_use_id })
    if (decision === 'deny') return { deny: 'Denied by a rule.' }
    if (decision === 'ask' && seen.refusals === 0) {
      seen.refusals++
      return { deny: denial }
    }
    seen.runs++
    return { result: { stdout: 'pushed', stderr: '', interrupted: false } }
  })

  on('tool.check', () => ({ decision: verdict }))

  return seen
}

test('runs the call once the person allows it', async ($, on) => {
  const seen = engine($, on, 'ask', 'Allow')
  const r = await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.questions).toHaveLength(1)
  expect(seen.questions[0]).toContain(COMMAND)
  expect(seen.questions[0]).toContain('Reason: Force-pushes to main')
  expect(seen.runs).toBe(1)
  expect(r.deny).toBeUndefined()
})

test('stays denied when the person denies it', async ($, on) => {
  const seen = engine($, on, 'ask', 'Deny')
  const r = await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.runs).toBe(0)
  expect(r.deny).toBe(CLASSIFIER_DENIAL)
})

test('passes on what the person typed instead', async ($, on) => {
  const seen = engine($, on, 'ask', 'push to a branch instead')
  const r = await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.runs).toBe(0)
  expect(r.deny).toContain('push to a branch instead')
})

test('stays denied when the dialog is dismissed', async ($, on) => {
  const seen = engine($, on, 'ask', undefined)
  const r = await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.runs).toBe(0)
  expect(r.deny).toBe(CLASSIFIER_DENIAL)
})

test('a deny rule is never put to the person', async ($, on) => {
  const seen = engine($, on, 'deny', 'Allow')
  await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.questions).toHaveLength(0)
  expect(seen.runs).toBe(0)
})

test("a refusal that isn't the classifier's is left alone", async ($, on) => {
  const seen = engine($, on, 'ask', 'Allow', "The user doesn't want to proceed with this tool use.")
  const r = await $.tool.call({ tool: 'Bash', command: COMMAND })

  expect(seen.questions).toHaveLength(0)
  expect(seen.runs).toBe(0)
  expect(r.deny).toContain("doesn't want to proceed")
})
