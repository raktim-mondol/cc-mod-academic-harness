// The $.state contract for the academic-harness mod.
// Each value the module keeps in $.state is declared here, under the mod's name.

/** Research mode as the user set it for this session; null follows the research_mode setting. */
export type ModeOverride = 'auto' | 'on' | 'off' | null

declare module 'claude-code' {
  interface PluginState {
    'academic-harness': { override: ModeOverride }
  }
}
