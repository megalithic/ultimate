import type { EntryRecord } from '@earendil-works/pi-durable'
import type { Message } from './refs.ts'

export const callerOf = (entries: readonly EntryRecord[], call: string) =>
  entries.findLast((entry) => {
    const message = entry.model?.[0]
    return (
      message?.role === 'assistant' &&
      message.content.some((block) => block.type === 'toolCall' && block.id === call)
    )
  })

export function cardOf(m: Message | undefined) {
  if (typeof m?.from === 'number' && m.call) return { conversation: m.from, call: m.call }
  if (typeof m?.to === 'number' && m.entry !== undefined)
    return { conversation: m.to, entry: m.entry }
  return undefined
}
