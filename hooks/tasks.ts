import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { foldReply, LEVELS, worthFolding } from './generated/fold-core'
import {
  FILE_LIMIT_BYTES,
  insideWorkspace,
  parseCommandArgs,
  planTask,
  runIdFrom,
  TASK_COMMANDS,
  TASK_IDS,
  TASK_LABELS,
  TASK_USAGE,
  toolName,
  WATCH_COMMAND,
  WATCH_USAGE,
  planWatch,
  withRunId,
} from './tasks-core'
import type { TaskId } from './tasks-core'
import { count } from './usage'

// The task commands (P5) and /fold.
//
//   /ah-research /ah-review /ah-papers /ah-references /ah-write /ah-analyze /ah-hypotheses
//
// Each research task is a slash command. The command reads the
// line, checks it the way upstream's submitAcademicTask does (hooks/tasks-core.ts, compared with upstream's own code by
// tests/scripts/tasks.test.mjs), then runs the same tool with the same arguments through $.tool.call. The tool goes on as a
// job when it is long (P4), and the completion notice (hooks/notices.ts) tells the model when it ends.
//
//   /fold [full|brief|points|outline|gist]   the last reply of the model, folded to that level (upstream's fold-core, unchanged)
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

const OUTPUT_LIMIT = 8000
export const FOLD_USAGE = 'Usage: /fold [full|brief|points|outline|gist]  (1 to 5 also work; brief is the default)'

function clip(text: string, limit = OUTPUT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} more characters; the full text is in the file the tool names)`
}

const usage = (task: TaskId): string => `Usage: /${TASK_COMMANDS[task]} ${TASK_USAGE[task]}`

/**
 * Every file a task names must be a file inside the folder, at most 50 MB (upstream's checks, in its words). The path is checked as written
 * (`..` folded) and then again where it really lands, so a symbolic link inside the folder cannot lead a command to a file outside it.
 */
async function checkFiles($: EngineInterface, cwd: string, files: readonly string[]): Promise<string | null> {
  let root = cwd
  if (files.length > 0) {
    try {
      root = (await $.fs.stat(cwd, { resolve: true })).realPath ?? cwd // the session folder may itself be reached through a link
    } catch {
      root = cwd
    }
  }
  for (const path of files) {
    const at = insideWorkspace(cwd, path)
    if (!at.ok) return at.error
    let stat
    try {
      stat = await $.fs.stat(at.abs, { resolve: true })
    } catch {
      return `file not found: ${path}`
    }
    if (stat.kind !== 'file') return `not a file: ${path}`
    if (stat.realPath === undefined) return `cannot tell where ${path} leads, so it was not used`
    if (!insideWorkspace(root, stat.realPath).ok) return `${path} is a link that leads outside the workspace (to ${stat.realPath}); copy the file into the folder to use it`
    if (stat.size > FILE_LIMIT_BYTES) return `file is larger than 50 MB: ${path}`
  }
  return null
}

/** The text a tool answered, or the reason it did not. */
function outcome(result: unknown): { ok: boolean; text: string } {
  const r = (result ?? {}) as { deny?: string; isError?: boolean; text?: string }
  if (typeof r.deny === 'string') return { ok: false, text: r.deny }
  if (r.isError) return { ok: false, text: r.text ?? 'the tool reported an error' }
  return { ok: true, text: r.text ?? '' }
}

/** One task command: check, then run the plan's steps in order. Returns the text to show. */
export async function runTask($: EngineInterface, task: TaskId, args: string): Promise<string> {
  const label = TASK_LABELS[task]
  const parsed = parseCommandArgs(args)
  if ('error' in parsed) return `${label}: ${parsed.error}. ${usage(task)}`
  const plan = planTask(task, parsed.prompt, parsed.effort)
  if (plan.error !== undefined) return `${label}: ${plan.error}. ${usage(task)}`
  const cwd = await $.session.cwd()
  const bad = await checkFiles($, cwd, plan.files)
  if (bad) return `${label}: ${bad}`

  const shown: string[] = [`${label}${parsed.effort === 'auto' ? '' : ` (effort ${parsed.effort})`}`]
  let previous = ''
  for (const step of plan.steps) {
    let next = step
    if (step.runIdFromPrevious) {
      const id = runIdFrom(previous)
      if (!id) return `${shown.join('\n')}\n\n${clip(previous)}\n\nThe run did not start: the tool answered without a run id. Say what it asked for in your next message, or run /${TASK_COMMANDS[task]} again with the missing detail.`
      next = withRunId(step, { run_id: id })
    }
    shown.push(`→ ${step.progress}`)
    let result: unknown
    try {
      result = await $.tool.call({ tool: toolName(next.tool), ...next.args })
    } catch (error) {
      return `${shown.join('\n')}\n\n${label} did not start: ${error instanceof Error ? error.message : String(error)}`
    }
    const done = outcome(result)
    if (!done.ok) return `${shown.join('\n')}\n\n${label} stopped at "${step.progress}": ${clip(done.text)}`
    previous = done.text
  }
  return `${shown.join('\n')}\n\n${clip(previous)}`
}

/** /ah-watch: run the saved literature searches that are due, then print what is new. */
export async function runWatch($: EngineInterface, args: string): Promise<string> {
  const plan = planWatch(args)
  if (plan.error !== undefined) return `Literature watch: ${plan.error}. Usage: /${WATCH_COMMAND} ${WATCH_USAGE}`
  const shown: string[] = ['Literature watch']
  let ran = ''
  for (const [i, step] of plan.steps.entries()) {
    shown.push(`→ ${step.progress}`)
    let result: unknown
    try {
      result = await $.tool.call({ tool: toolName(step.tool), ...step.args })
    } catch (error) {
      return `${shown.join('\n')}\n\nLiterature watch did not start: ${error instanceof Error ? error.message : String(error)}`
    }
    const done = outcome(result)
    if (!done.ok) return `${shown.join('\n')}\n\nLiterature watch stopped at "${step.progress}": ${clip(done.text)}`
    if (i === 0) {
      ran = done.text
      // nothing saved, or nothing due: there is nothing to read
      if (/no watches to run/i.test(ran)) return `${shown.join('\n')}\n\n${clip(ran)}\n\nSave a search first: ask for a watch to be added (literature_watch, action add), then run /${WATCH_COMMAND} again, or schedule it with /loop 1d /${WATCH_COMMAND}.`
    } else return `${shown.join('\n')}\n\n${clip(ran, 3000)}\n\n${clip(done.text)}`
  }
  return shown.join('\n')
}

/** The last thing the model said, folded. */
export async function runFold($: EngineInterface, args: string): Promise<string> {
  const word = (args ?? '').trim().toLowerCase() || 'brief'
  if (!(LEVELS as readonly string[]).includes(word) && !/^[1-5]$/.test(word)) return `Unknown level "${word}". ${FOLD_USAGE}`
  const messages = await $.session.messages()
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')
  if (!last) return `There is no reply to fold yet. ${FOLD_USAGE}`
  const folded = foldReply(last.text, word)
  const head = `Last reply, folded to ${folded.level}: ${folded.shown} of ${folded.total} words`
  if (folded.level === 'full') return `${head} (nothing hidden)\n\n${folded.text}`
  const note = worthFolding(last.text, folded.text) ? '' : ' (a short reply: folding hides little)'
  return `${head}${note}\n\n${folded.text}`
}

/** Declare the commands. Called from the one session.start hook. */
export async function registerTaskCommands($: EngineInterface): Promise<void> {
  for (const task of TASK_IDS) {
    try {
      await $.command.register({ name: TASK_COMMANDS[task], description: `${TASK_LABELS[task]}: ${TASK_USAGE[task]}`, argumentHint: TASK_USAGE[task] })
    } catch {
      // a name that is taken: that command is left out, the others stay
    }
  }
  try {
    await $.command.register({ name: WATCH_COMMAND, description: `Run the saved literature searches that are due and print what is new: ${WATCH_USAGE}`, argumentHint: '[--all] [--preview]' })
  } catch {
    // another plugin has the name: carry on without it
  }
  try {
    await $.command.register({ name: 'fold', description: 'Fold the last reply: full, brief, points, outline or gist', argumentHint: '[level]' })
  } catch {
    // another plugin has /fold: carry on without it
  }
}

/**
 * The command.run hooks. A task command is the person's own request to run that tool, and the mod's `$.tool.call` of it needs no
 * permission rule of its own: only a deny rule, a hook's ask or an organization's ask refuse such a call (shown live, tests/live/p5.mjs),
 * so none is added here and none is overridden.
 */
export function registerTasks(on: On, options: PluginOptions): void {
  for (const task of TASK_IDS) {
    on('command.run', { command: TASK_COMMANDS[task] }, async ($, e) => {
      await count($, options, 'commands', TASK_COMMANDS[task])
      return { text: await runTask($, task, e.args) }
    })
  }
  on('command.run', { command: WATCH_COMMAND }, async ($, e) => {
    await count($, options, 'commands', WATCH_COMMAND)
    return { text: await runWatch($, e.args) }
  })
  on('command.run', { command: 'fold' }, async ($, e) => {
    await count($, options, 'commands', 'fold')
    return { text: await runFold($, e.args) }
  })
}
