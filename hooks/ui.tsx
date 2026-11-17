import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { jobsDir } from './jobs-core'
import { showStatus } from './mode'
import { records } from './notices'
import { arrange, EMPTY_PANEL, hasRoomForGaps, jobRows, layoutFor, live, noteRows, notebookName, parseBridge, resetLive, runningCount, sections, statusKey } from './ui-core'
import type { PanelState } from './ui-core'

// The interface (P5): one status line and one pane.
//
// Status line  `research mode on · 1 job running · gate FAIL (5 blocking)`. One line per plugin, so every part of it goes through
//              composeStatus (ui-core.ts) and showStatus (mode.ts). A timer refreshes the job count; the gate is read again after each
//              turn, through server/bin/ah-ui.mjs, which asks the engine's `ah state` (the engine, not this module, knows the gate).
// Pane         `/academic` opens it: the project's state, this session's jobs, the notebook's last entries and the PaperMemory counts.
//              Wide (96 columns and up) it is two columns, narrow it is one. While it is open a timer keeps the file-based parts fresh and
//              reads the engine side every half minute. The pane draws what the last refresh stored in $.state; it starts no process itself.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

export const PANE_ID = 'academic'
const PERIOD_MS = 5000
const BRIDGE_EVERY = 6 // ticks: 30 s while the pane is open
const BRIDGE_TIMEOUT_MS = 40_000

const panel = atom({ plugin: 'academic-harness', key: 'panel' } as const, EMPTY_PANEL, { shape: 'panel-1' })
let timer: { cancel: () => void } | null = null
let ticks = 0
let gateStale = true
let busy = false

async function homeDir($: EngineInterface): Promise<string | null> {
  try {
    return jobsDir(await $.env.get('AH_MOD_HOME'), await $.env.get('HOME'))
  } catch {
    return null
  }
}

/** Run the bridge (`panel` or `gate`) for `cwd`. Null when it cannot be run; the caller keeps what it had. */
async function bridge($: EngineInterface, verb: 'panel' | 'gate', cwd: string): Promise<ReturnType<typeof parseBridge> | null> {
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/server/bin/ah-ui.mjs`, verb, cwd], { cwd, timeoutMs: BRIDGE_TIMEOUT_MS })
    if (r.exitCode !== 0) return { error: `the interface bridge exited ${r.exitCode}` }
    return parseBridge(r.stdout)
  } catch {
    return null
  }
}

async function readNotes($: EngineInterface, cwd: string, session: string): Promise<PanelState['notes']> {
  try {
    const text = await $.fs.read(`${cwd.replace(/\/+$/, '')}/.dsh/notebook/${notebookName(session)}`)
    return noteRows(typeof text === 'string' ? text : String((text as { text?: string }).text ?? ''))
  } catch {
    return [] // no notebook yet
  }
}

/** Read the parts that live in files: this session's jobs and notebook. Cheap, so the timer does it every period. */
async function readFiles($: EngineInterface): Promise<{ cwd: string; session: string; jobs: PanelState['jobs']; running: number; notes: PanelState['notes'] }> {
  const cwd = await $.session.cwd()
  const session = await $.session.id()
  const dir = await homeDir($)
  const all = dir ? await records($, dir) : []
  return { cwd, session, jobs: jobRows(all, session), running: runningCount(all, session), notes: await readNotes($, cwd, session) }
}

/** Refresh the line: read the jobs, the gate when stale, and write the one status text if it would read differently. */
async function refreshStatus($: EngineInterface, options: PluginOptions, running: number, cwd: string): Promise<void> {
  if (gateStale) {
    gateStale = false
    const got = await bridge($, 'gate', cwd)
    if (got && !('error' in got)) live.gate = (got.project && 'gate' in got.project ? got.project.gate : null) ?? null
  }
  live.jobs = running
  if (statusKey(live.jobs, live.gate, live.router) !== live.shownKey) await showStatus($, options)
}

/** Refresh the pane's data (and the line with it). `withBridge` asks the engine and PaperMemory too. */
export async function refreshPanel($: EngineInterface, options: PluginOptions, withBridge: boolean): Promise<PanelState> {
  const files = await readFiles($)
  const now = await $.clock.now()
  const stored = await read($, panel)
  let project = stored.project
  let library = stored.library
  if (withBridge) {
    const got = await bridge($, 'panel', files.cwd)
    if (got && !('error' in got)) {
      project = got.project
      library = got.library
      live.gate = (project && 'gate' in project ? project.gate : null) ?? null
      gateStale = false
    } else if (got) {
      project = { error: got.error }
    }
  }
  const next: PanelState = { at: now, cwd: files.cwd, project, library, jobs: files.jobs, notes: files.notes }
  await update($, panel, () => next)
  live.jobs = files.running
  if (statusKey(live.jobs, live.gate, live.router) !== live.shownKey) await showStatus($, options)
  return next
}

async function paneIsOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE_ID)
  } catch {
    return false
  }
}

/** Start the line's timer. Interactive sessions only: a headless run has no status line to keep. */
export async function startUi($: EngineInterface, options: PluginOptions, isInteractive: boolean): Promise<void> {
  resetLive()
  gateStale = true
  ticks = 0
  timer?.cancel?.()
  timer = null
  if (!isInteractive) return
  try {
    const cwd = await $.session.cwd()
    const files = await readFiles($)
    await refreshStatus($, options, files.running, cwd)
  } catch {
    // the line is a convenience: a session that cannot say where it is keeps the mode-only line
  }
  try {
    timer = $.clock.every(PERIOD_MS, async () => {
      if (busy) return
      busy = true
      try {
        ticks++
        if (await paneIsOpen($)) {
          await refreshPanel($, options, ticks % BRIDGE_EVERY === 1)
        } else {
          const files = await readFiles($)
          await refreshStatus($, options, files.running, files.cwd)
        }
      } catch {
        // never break the session over a refresh; the next period tries again
      } finally {
        busy = false
      }
    })
  } catch {
    timer = null // no clock: the line stays as it was last written
  }
}

export function stopUi(): void {
  timer?.cancel?.()
  timer = null
}

/** /academic with no word (or `pane`): open the pane, read it once so it opens full. Returns one line for the command's output. */
export async function openPane($: EngineInterface, options: PluginOptions): Promise<string> {
  try {
    await refreshPanel($, options, true)
  } catch {
    // the pane opens anyway and shows what the next refresh finds
  }
  try {
    const opened = await $.ui.open({ id: PANE_ID, title: 'Academic Harness' })
    if (opened && opened.isPlaced === false) return `The pane did not open (${opened.reason}). Widen the terminal, or run /academic again.`
    return 'Pane opened: project, jobs, notebook and library. Close it with its mark or ctrl+x x.'
  } catch (error) {
    return `The pane could not open: ${error instanceof Error ? error.message : String(error)}`
  }
}

export function registerUi(on: On): void {
  // The gate changes when files do, and files change during a turn: read it again once the turn is over.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    gateStale = true
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = await read($, panel)
    const layout = layoutFor(e.props.bodyColumns)
    const columns = arrange(sections(state, layout.width, layout.columns === 1), layout)
    const gap = hasRoomForGaps(columns, e.props.scroll.bodyRows) ? 1 : 0
    const color = (tone: string): { dimColor?: boolean; color?: string; bold?: boolean } =>
      tone === 'dim' ? { dimColor: true } : tone === 'warn' ? { color: 'yellow' } : tone === 'ok' ? { color: 'green' } : tone === 'bad' ? { color: 'red' } : {}
    return (
      <Box flexDirection="row" gap={3}>
        {columns.map((col, columnIndex) => (
          <Box key={`column-${columnIndex}`} flexDirection="column" width={layout.width} flexShrink={0}>
            {col.map((section, sectionIndex) => (
              <Box key={`section-${sectionIndex}`} flexDirection="column" marginBottom={gap}>
                <Text bold>{section.title}</Text>
                {section.lines.map((line, lineIndex) => (
                  <Text key={`${section.title}-${lineIndex}`} wrap="truncate-end" {...color(line.tone)}>
                    {line.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}

