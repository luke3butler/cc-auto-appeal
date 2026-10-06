import type { Register, ToolCallArgs, ToolCallResult } from 'claude-code'

// The model's calls whose verdict was `ask`, which auto mode hands to its
// classifier, by tool_use_id.
const asked = new Set<string>()

// Retries the person allowed, each let past the permission check once.
type Retry = { tool: string; isUsed: boolean }
const retries: Retry[] = []

const DEMO_COMMAND = 'echo auto-appeal-test'
const DEMO_DENIAL =
  "Permission for this action was denied by the Claude Code auto mode classifier. Reason: Simulated denial (auto-appeal demo). If you have other tasks that don't depend on this action, continue working on those."

export const register: Register = on => {
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    // Only the retry itself: $.ui.ask raises a call of this plugin's too, and
    // its `ask` is the dialog.
    if (next.origin.plugin === $.plugin.name) {
      const retry = retries.find(r => r.tool === e.tool && !r.isUsed)
      if (!retry || verdict.decision === 'deny') return verdict
      retry.isUsed = true
      return { decision: 'allow', reason: 'The user allowed it after auto mode blocked it.' }
    }

    if (verdict.decision === 'ask' && e.tool_use_id && next.origin.plugin === 'engine') {
      asked.add(e.tool_use_id)
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    // A demo: this one inert command gets a stand-in classifier denial, so you
    // can see the question without getting the classifier to block anything.
    const isDemo = e.tool === 'Bash' && (e as { command?: string }).command === DEMO_COMMAND
    if (isDemo && e.tool_use_id) asked.add(e.tool_use_id)
    const ran: ToolCallResult = isDemo ? { deny: DEMO_DENIAL } : await next(e)
    if (!e.tool_use_id || !asked.delete(e.tool_use_id)) return ran

    const reason = classifierReason(ran)
    if (reason === undefined) return ran

    const { tool, tool_use_id, agentId, consent, ...args } = e as typeof e & { consent?: string }
    let answer: string
    try {
      answer = await $.ui.ask(`Auto mode blocked ${tool}: ${summarize(args)}\nReason: ${reason}\nRun it anyway?`, {
        header: 'Auto mode',
        options: ['Allow', 'Deny'],
      })
    } catch {
      return ran // Dismissed, or no one to ask: the denial stands.
    }
    if (answer === 'Deny') return ran
    if (answer !== 'Allow') {
      return { deny: `Auto mode blocked this call and the user declined it, saying: ${answer}` }
    }

    const retry: Retry = { tool, isUsed: false }
    retries.push(retry)
    try {
      return relay(await $.tool.call({ tool, ...args } as ToolCallArgs))
    } finally {
      retries.splice(retries.indexOf(retry), 1)
    }
  })
}

// The classifier's reason when `r` is its denial, as the model would read it:
// "Permission for this action was denied by the Claude Code auto mode
// classifier. Reason: <reason>. If you have other tasks ..."
function classifierReason(r: ToolCallResult): string | undefined {
  const text = r.deny ?? (r.isError ? r.text : undefined)
  if (!text || !/auto mode classifier/i.test(text)) return undefined
  return /Reason:\s*(.*?)(?:\.\s+If you have|\n|$)/.exec(text)?.[1]?.trim() || 'none given'
}

// What the call does, in a line: its command, else its file, else its input.
function summarize(args: Record<string, unknown>): string {
  const text = typeof args.command === 'string' ? args.command
    : typeof args.file_path === 'string' ? args.file_path
    : JSON.stringify(args)
  return text.length > 300 ? `${text.slice(0, 299)}…` : text
}

// The retry's answer as this call's own: its result or its refusal.
function relay(r: ToolCallResult): ToolCallResult {
  if (r.deny !== undefined) return { deny: r.deny }
  return r.context ? { result: r.result, context: r.context } : { result: r.result }
}
