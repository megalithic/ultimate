import { join } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import type { JsonObject } from '@earendil-works/pi-durable'
import { implementAction } from '../../lib/actions.ts'
import { rebuiltOnOpen, meansNone } from '../../lib/errors.ts'
import { readJson, updateJson } from '../../lib/json-file.ts'
import { githubRepo, readGithubRepo } from '../../lib/project-identity.ts'
import type { GithubRepo } from '../../lib/project-identity.ts'
import { postAction } from '../../lib/remote.ts'
import { readSettings, userSettingsPath } from '../../lib/settings.ts'
import { spawn } from '../../lib/spawn.ts'
import type { ExtensionHost } from '../../server/extensions.ts'
import type { ProjectInfo } from '../../server/project.ts'
import { MessagesApi } from '../messages/api.ts'
import { ForgetAction, ListAction, PinAction, StartAction, StoppedAction } from './refs.ts'
import type { RunningProject, StoppedProject } from './refs.ts'

const REMOTE_COUNTS_TIMEOUT_MS = 1_500

type Counts = { busy: number; questions: number }

async function localCounts(host: ExtensionHost): Promise<Counts> {
  return {
    busy: host.conversations().filter((conversation) => conversation.busy).length,
    questions: (await host.need(MessagesApi).openQuestions(context)).length,
  }
}

async function timedRemoteCounts(name: string, url: string, signal: AbortSignal) {
  const status = (await postAction(
    { url, label: name },
    'status',
    'status',
    {},
    AbortSignal.any([signal, AbortSignal.timeout(REMOTE_COUNTS_TIMEOUT_MS)]),
  ).catch(meansNone)) as { busy?: unknown; questions?: { count?: unknown } } | undefined
  const busy = status?.busy
  const questions = status?.questions?.count
  return typeof busy === 'number' && typeof questions === 'number' ? { busy, questions } : {}
}

const repoCache = new Map<string, GithubRepo | null>()
const pendingRepoReads = new Set<string>()
function cachedRepo(root: string | undefined) {
  if (!root) return undefined
  if (!repoCache.has(root) && !pendingRepoReads.has(root)) {
    pendingRepoReads.add(root)
    rebuiltOnOpen(
      'a later project list reads the repository cache again',
      (async () => {
        const key = await githubRepo(root)
        repoCache.set(root, key ? await readGithubRepo(key) : null)
        pendingRepoReads.delete(root)
      })(),
    )
  }
  return repoCache.get(root) ?? undefined
}

function checkoutName(name: string, root: string | undefined) {
  const worktree = /\/\.ultimate\/projects\/(.+)-[\da-f]{8}\/worktrees\/(\d+)$/.exec(root ?? '')
  return worktree ? `${worktree[1]} #${worktree[2]}` : name
}

async function tailnetPorts(host: ExtensionHost) {
  type Registry = { ports?: Record<string, { port?: unknown }> }
  const registryOrNoPorts = await readJson<Registry>(
    join(host.userHome, '.ultimate', 'tailscale.json'),
    {},
  ).catch((): Registry => ({}))
  const ports: Record<string, number> = {}
  for (const [root, entry] of Object.entries(registryOrNoPorts.ports ?? {}))
    if (typeof entry?.port === 'number') ports[root] = entry.port
  return ports
}

async function hubRoot(host: ExtensionHost) {
  const settings = await readSettings(userSettingsPath(host.userHome)).catch((): JsonObject => ({}))
  const fleet = settings.fleet
  const primary =
    fleet && typeof fleet === 'object' && !Array.isArray(fleet) ? fleet.primary : undefined
  if (typeof primary !== 'string') return undefined
  return primary === '~' || primary.startsWith('~/')
    ? join(host.userHome, primary.slice(1))
    : primary
}

export async function list(host: ExtensionHost, signal: AbortSignal): Promise<RunningProject[]> {
  const [tailnet, hub] = await Promise.all([tailnetPorts(host), hubRoot(host)])
  return Promise.all(
    (await host.projects()).flatMap(({ name, root, running, current }) => {
      const processOrLockUrl = current ? host.system().process.url : running?.url
      if (!processOrLockUrl) return []
      return [
        (async () => {
          const repo = cachedRepo(root)
          return {
            name: checkoutName(name, root),
            url: processOrLockUrl,
            current,
            ...(repo && { repo: { name: repo.name, url: repo.url, visibility: repo.visibility } }),
            ...(root && tailnet[root] ? { tailnetPort: tailnet[root] } : {}),
            ...(root && root === hub ? { hub: true as const } : {}),
            ...(current
              ? await localCounts(host)
              : await timedRemoteCounts(name, processOrLockUrl, signal)),
          }
        })(),
      ]
    }),
  )
}

const forgottenPath = (host: ExtensionHost) =>
  join(host.userHome, '.ultimate', 'projects-forgotten.json')
const readForgotten = async (path: string) => {
  const value = await readJson<unknown>(path, {})
  const forgotten: Record<string, number> = {}
  if (value && typeof value === 'object' && !Array.isArray(value))
    for (const [home, at] of Object.entries(value)) if (typeof at === 'number') forgotten[home] = at
  return forgotten
}

const isStopped = (project: ProjectInfo) => !project.current && !project.running

function lastActive({ openedAt, conversations }: ProjectInfo) {
  const times = conversations.flatMap(({ inputAt, answerAt }) => [inputAt ?? 0, answerAt ?? 0])
  return Math.max(openedAt ?? 0, ...times)
}

export async function stopped(host: ExtensionHost): Promise<StoppedProject[]> {
  const [registry, forgotten, hub] = await Promise.all([
    host.projects(),
    readForgotten(forgottenPath(host)),
    hubRoot(host),
  ])
  return registry
    .filter(
      (project) => isStopped(project) && !(forgotten[project.home] >= (project.openedAt ?? 0)),
    )
    .map((project) => {
      const repo = cachedRepo(project.root)
      const active = lastActive(project)
      return {
        name: checkoutName(project.name, project.root),
        home: project.home,
        ...(project.root ? { root: project.root } : {}),
        ...(repo && { repo: { name: repo.name, url: repo.url, visibility: repo.visibility } }),
        ...(active ? { lastActive: active } : {}),
        ...(project.root && project.root === hub ? { hub: true as const } : {}),
      }
    })
    .toSorted((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
}

async function stoppedProject(host: ExtensionHost, args: unknown) {
  const home =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { home?: unknown }).home
      : undefined
  if (typeof home !== 'string') throw new Error('home must be a string')
  const project = (await host.projects()).find((candidate) => candidate.home === home)
  if (!project) throw new Error(`No project has its state in ${home}`)
  if (!isStopped(project)) throw new Error(`${project.name} is running`)
  return project
}

const MEGA_START_TIMEOUT_MS = 30_000

function megaStart(root: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('mega', ['start', root], {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(MEGA_START_TIMEOUT_MS),
    })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8')
      stream?.on('data', (text: string) => (output += text))
    }
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(output.trim() || `mega start exited with ${code}`)),
    )
  })
}

const sharedRailPinPath = (host: ExtensionHost) =>
  join(host.userHome, '.ultimate', 'projects-rail.json')
const readPin = async (path: string) => {
  const value = await readJson<{ pinned?: unknown }>(path, {})
  return { pinned: value.pinned === true }
}

export default function projects(host: ExtensionHost) {
  host.need(MessagesApi)
  return defineExtension({ name: 'projects' })
}

export const pollActions = ['list', 'pin', 'stopped']

export const actions = {
  list: implementAction(ListAction, (_args, { host, signal }) => list(host, signal)),
  stopped: implementAction(StoppedAction, (_args, { host }) => stopped(host)),
  forget: implementAction(ForgetAction, async (args, { host }) => {
    const { home } = await stoppedProject(host, args)
    await updateJson(forgottenPath(host), readForgotten, (forgotten) => {
      forgotten[home] = Date.now()
    })
    return {}
  }),
  start: implementAction(StartAction, async (args, { host }) => {
    const project = await stoppedProject(host, args)
    if (!project.root) throw new Error(`${project.name} has no folder on record`)
    return { output: await megaStart(project.root) }
  }),
  pin: implementAction(PinAction, async (args, { host }) => {
    const pinned =
      args && typeof args === 'object' && !Array.isArray(args) ? args.pinned : undefined
    if (pinned !== undefined && typeof pinned !== 'boolean')
      throw new Error('pinned must be a boolean')
    const path = sharedRailPinPath(host)
    if (pinned !== undefined)
      await updateJson(path, readPin, (value) => {
        value.pinned = pinned
      })
    return readPin(path)
  }),
}
