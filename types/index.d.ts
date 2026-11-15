// The $.state contract for the academic-harness mod.
// Each value the module keeps in $.state is declared here, under the mod's name.

/** Research mode as the user set it for this session; null follows the research_mode setting. */
export type ModeOverride = 'auto' | 'on' | 'off' | null

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
    }
  }
}
