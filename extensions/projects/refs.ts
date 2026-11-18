/** Projects in the browser: the Ultimate instances running on this machine, for the rail. Browser-safe. */
import { actionRef } from '../../shared/extension-api.ts'

/** One running instance: its project's name, its loopback URL, and its live state when it answered. */
export type RunningProject = {
  name: string
  url: string
  /** The instance this page shows. */
  current: boolean
  /**
   * Its `origin` on GitHub, `<owner>/<repo>` as GitHub spells it, with its visibility when `gh` knew it; absent off
   * GitHub and until the first read finished.
   */
  repo?: { name: string; url: string; visibility?: 'public' | 'private' | 'internal' }
  /** Conversations running a turn now; absent when its `status` did not answer. */
  busy?: number
  /** Messages waiting on the user's answer; absent when its `status` did not answer. */
  questions?: number
  /** Its HTTPS port on the tailnet, when Tailscale registered one: where a page opened over the tailnet reaches it. */
  tailnetPort?: number
  /** It is the hub: its folder is `fleet.primary` in user settings. */
  hub?: true
}

/** A project that ran on this machine before and runs no instance now, from its state home. */
export type StoppedProject = {
  name: string
  /** Its state home, `~/.ultimate/projects/<name>-<hash>`: what `forget` and `start` take. */
  home: string
  root?: string
  repo?: RunningProject['repo']
  /** The newest of its last opening and its conversations' inputs and answers. */
  lastActive?: number
  hub?: true
}

/** No arguments → every running instance on this machine, this one included, in project order. */
export const ListAction = actionRef<null, RunningProject[]>('projects', 'list')

/** No arguments → every stopped project not forgotten since it last opened, most recently active first. */
export const StoppedAction = actionRef<null, StoppedProject[]>('projects', 'stopped')

/** `{ home }` → hides a stopped project from the rail until it opens again; its state home stays as it is. */
export const ForgetAction = actionRef<{ home: string }, Record<string, never>>('projects', 'forget')

/** `{ home }` → starts a stopped project with `mega start <root>`, returning what it printed. */
export const StartAction = actionRef<{ home: string }, { output: string }>('projects', 'start')

/** `{ pinned? }` → whether the rail stays open, shared by every instance on this machine; `pinned` sets it first. */
export const PinAction = actionRef<{ pinned?: boolean }, { pinned: boolean }>('projects', 'pin')
