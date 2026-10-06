# auto-appeal

A Claude Code mod. When the auto-mode classifier blocks a tool call, you're asked whether to run it anyway, instead of Claude being told to find another way.

The question shows the tool, its command or file, and the classifier's reason:

- **Allow** runs the call anyway, and Claude gets its real result.
- **Deny**, or dismissing the question, leaves the classifier's denial as it was.
- Typing your own answer declines the call and passes your words to Claude.

It only steps in on the classifier's own denials. A call denied by a permission rule, by a hook, or by you in a permission dialog is left alone, and a deny rule still holds on the retry. With no one to ask (`claude -p`), the denial stands.

The session waits on the question, so a session left unattended stalls on a blocked call rather than working around it.

## Install

```
/plugin install auto-appeal --marketplace luke3butler/cc-auto-appeal
```

## Try it

The classifier rarely blocks anything harmless, so the mod treats one inert command as a classifier denial. Ask Claude to run `echo auto-appeal-test` with Bash. You'll be asked about it, and on Allow the echo really runs, through the same retry a real denial gets.

## How it works

1. `tool.check` notes each of the model's calls whose verdict is `ask`, which auto mode hands to its classifier.
2. `tool.call` sees such a call come back refused with the classifier's denial ("denied by the Claude Code auto mode classifier. Reason: …") and asks with `$.ui.ask`.
3. On Allow it re-issues the call with `$.tool.call`; its own `tool.check` hook turns that one retry's `ask` into `allow`, so the classifier isn't asked again.

It uses only `tool.check` and `tool.call`, never `classic.*` hooks. Where managed settings seat `sec-default` (Team and Enterprise organizations, machines with managed settings), a user-installed mod's classic hooks are passed over, so `PreToolUse` and `PermissionDenied` would never reach it. That is also why it asks in an AskUserQuestion dialog rather than the native permission dialog, which only a classic `PreToolUse` `ask` raises in auto mode.

## Develop

```
claude plugin validate .
claude plugin test .
```
