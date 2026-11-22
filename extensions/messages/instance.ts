import { implementAction } from '../../lib/actions.ts'
import { meansNone } from '../../lib/errors.ts'
import { locate, postAction } from '../../lib/remote.ts'
import { InstanceAction } from './refs.ts'

const INSTANCE_TIMEOUT_MS = 2_000

const named = (value: unknown, name: string) => {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 200))
    throw new Error(`${name} must be a nonempty string`)
  return value
}

export const instance = implementAction(InstanceAction, async (args, { host, signal }) => {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const project = named(input.project, 'project')
  if (!project) throw new Error('project must name a project')
  const machine = named(input.machine, 'machine')
  const target = await locate(host, project, machine).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  )
  if (typeof target === 'string') return { error: target }
  if ('current' in target) return { current: true as const }
  const quick = AbortSignal.any([signal, AbortSignal.timeout(INSTANCE_TIMEOUT_MS)])
  const [tailscale, status] = await Promise.all([
    postAction(target, 'tailscale', 'status', null, quick).catch(meansNone) as Promise<
      { url?: string } | undefined
    >,
    postAction(target, 'status', 'status', {}, quick).catch(meansNone),
  ])
  if (tailscale === undefined && status === undefined)
    return { error: `${target.label} isn't running` }
  const tailnet =
    typeof tailscale?.url === 'string' && tailscale.url.startsWith('https://')
      ? tailscale.url
      : undefined
  return {
    url: target.url,
    label: target.label,
    name: target.name,
    ...(tailnet ? { tailnet } : {}),
  }
})
