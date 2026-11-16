// The $.state contract for the academic-harness mod.
// Each value the module keeps in $.state is declared here, under the mod's name.

/** Research mode as the user set it for this session; null follows the research_mode setting. */
export type ModeOverride = 'auto' | 'on' | 'off' | null

/** What the pane shows (hooks/ui-core.ts PanelState): one value, so a refresh is one write. */
export type PanelValue = {
  at: number
  cwd: string
  project: { root: string; lines: string[]; gate: { status: 'PASS' | 'FAIL'; blocking: number; open: number } | null; error?: string } | { error: string } | null
  library: { papers?: number; citable?: number; claims?: number; notes?: number; error?: string } | null
  jobs: { id: string; kind: string; label: string; status: string; detail: string; startedAt: number | null; endedAt: number | null }[]
  notes: { at: number; type: string; title: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'academic-harness': {
      override: ModeOverride
      /** Sessions whose stop gate already handed its findings to the author this turn. */
      handedOff: string[]
      /** Sessions that already got the advisory evidence-check note this turn. */
      t3Steered: string[]
      /** Background jobs already announced to the person. */
      noticed: string[]
      /** The pane's data, as the last refresh read it. */
      panel: Shaped<PanelValue>
    }
  }
}
