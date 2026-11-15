// The $.state contract for the academic-harness mod.
// Each value the module keeps in $.state is declared here, under the mod's name.

export type LoadProof = { loads: number }

declare module 'claude-code' {
  interface PluginState {
    'academic-harness': LoadProof
  }
}
