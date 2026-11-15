/** The session info appended to the hint line under the prompt; empty adds nothing. */
export type StatusLine = string

declare module 'claude-code' {
  interface PluginState {
    'hacker-hud': { line: StatusLine }
  }
}
