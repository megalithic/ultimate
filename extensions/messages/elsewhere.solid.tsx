import { api, events, notify } from '@/sdk/solid'
import { InstanceAction } from './refs.ts'
import type { Instance } from './refs.ts'

type Found = Exclude<Instance, { current: true } | { error: string }>

const loopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')

export function openableUrl(found: Found, page: URL) {
  return loopback(page.hostname) || !loopback(new URL(found.url).hostname)
    ? found.url
    : found.tailnet
}

const blank = (tab: Window) => {
  try {
    return tab.location.href === 'about:blank'
  } catch {
    return false
  }
}

export async function openElsewhere(target: {
  message: number
  project: string
  machine?: string
}) {
  const found = await api
    .action(InstanceAction, {
      project: target.project,
      ...(target.machine ? { machine: target.machine } : {}),
    })
    .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
  if ('error' in found) return notify({ level: 'info', message: found.error })
  if ('current' in found) {
    events.emit('messages:open', { message: target.message })
    return
  }
  const base = openableUrl(found, new URL(location.href))
  if (!base)
    return notify({
      level: 'info',
      message: `${found.label} has no tailnet address, so its messages open only on that machine`,
    })
  const url = new URL(base)
  url.searchParams.set('message', String(target.message))
  const tab = window.open('', `ultimate:${url.origin}`)
  if (!tab)
    return notify({ level: 'info', message: `The browser blocked the tab for ${found.label}` })
  if (blank(tab)) tab.opener = null
  tab.location.href = url.href
}
