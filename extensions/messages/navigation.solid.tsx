import type { ConversationId } from '@earendil-works/pi-durable'
import { createEffect, createSignal, onSettled } from 'solid-js'
import {
  api,
  events,
  keepLast,
  notify,
  ROOT,
  showSurface,
  switchConversation,
  useConversation,
  useDocOf,
  useEvent,
  useReady,
  useStore,
} from '@/sdk/solid'
import { callerOf, cardOf } from './caller.ts'
import { CallerAction, MessagesDoc } from './refs.ts'

type Target =
  | { message: number }
  | {
      conversation: ConversationId
      entry?: number
      call?: string
      card?: number
      highlight?: boolean
    }

function fromAddress(): Target | undefined {
  const url = new URL(location.href)
  if (!url.searchParams.has('message')) return undefined
  const message = Number(url.searchParams.get('message'))
  url.searchParams.delete('message')
  history.replaceState(history.state, '', url)
  if (Number.isSafeInteger(message)) return { message }
  return undefined
}

export function MessageNavigation() {
  const current = useConversation()
  const surface = useStore((state) => state.ui.surface?.id ?? 'agent')
  const log = useDocOf(() => ROOT, MessagesDoc)
  const ready = useReady()
  const [target, setTarget] = createSignal<Target>()
  useEvent('messages:open', (value) => setTarget(value as Target))
  onSettled(() => {
    const initial = fromAddress()
    if (initial) setTarget((pending) => pending ?? initial)
  })

  createEffect(
    () => {
      const wanted = target()
      if (!wanted || !('message' in wanted)) return undefined
      const messages = log()?.messages
      if (!messages) return undefined
      return {
        message: wanted.message,
        place: cardOf(messages.find((m) => m.id === wanted.message)),
      }
    },
    (resolved) => {
      if (!resolved) return
      if (!resolved.place) {
        notify({ level: 'info', message: `Message ${resolved.message} not found` })
        setTarget(undefined)
        return
      }
      showSurface('agent')
      switchConversation(resolved.place.conversation)
      setTarget({ ...resolved.place, card: resolved.message, highlight: true })
    },
  )

  createEffect(
    () => {
      const wanted = target()
      if (!wanted || 'message' in wanted || !ready().ready || surface() !== 'agent')
        return undefined
      const { id, entries, loading } = current()
      if (id !== wanted.conversation || loading) return undefined
      const toolCallId = wanted.call?.split('/')[0]
      const entry = wanted.entry ?? (toolCallId ? callerOf(entries, toolCallId)?.id : undefined)
      return { ...wanted, toolCallId, entry }
    },
    (wanted) => {
      if (!wanted) return undefined
      const { conversation, call, toolCallId, entry, card, highlight } = wanted
      const reveal = (entryId: number) =>
        events.emit('ultimate:reveal-entry', {
          conversationId: conversation,
          entryId,
          toolCallId,
          selector: card === undefined ? undefined : `[data-message-outgoing="${card}"]`,
          highlight,
        })
      if (entry !== undefined) {
        const frame = requestAnimationFrame(() => {
          setTarget(undefined)
          reveal(entry)
        })
        return () => cancelAnimationFrame(frame)
      }
      setTarget(undefined)
      if (call)
        void api.action(CallerAction, { conversation, call }).then((result) => {
          if (result.entry !== undefined) reveal(result.entry)
        }, keepLast)
      return undefined
    },
  )
  return null
}
