import type { MouseEvent, ReactNode } from 'react'
import { parseMessageMention, parseRemoteMessageMention } from '@/components/ai/mentions'
import { events, ROOT, useDocOf } from '@/sdk'
import { cardOf } from './caller.ts'
import { openElsewhere } from './elsewhere.tsx'
import { MessagesDoc } from './refs.ts'

const chip =
  'mx-px rounded-sm px-0.5 font-mono text-[0.92em] text-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-2 transition-colors outline-none hover:bg-accent focus-visible:bg-accent'

export function MessageMentionLink({
  href,
  children,
  core,
}: {
  href: string
  children: ReactNode
  core: ReactNode
}) {
  const id = parseMessageMention(href)
  const elsewhere = parseRemoteMessageMention(href)
  const message = useDocOf(ROOT, MessagesDoc)?.messages.find((m) => m.id === id)
  if (elsewhere) {
    const where = `${elsewhere.project}${elsewhere.machine ? ` on ${elsewhere.machine}` : ''}`
    return (
      <a
        className={chip}
        data-conversation-mention
        data-message-elsewhere={`${elsewhere.message}@${where}`}
        href={`?message=${elsewhere.message}`}
        onClick={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          void openElsewhere(elsewhere)
        }}
        title={`Open message ${elsewhere.message} in ${where}'s Ultimate`}
      >
        {children}
      </a>
    )
  }
  if (id === undefined) return core
  const copyElsewhere =
    message && !cardOf(message) && message.remote?.id !== undefined ? message.remote : undefined
  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (copyElsewhere)
      void openElsewhere({
        message: copyElsewhere.id!,
        project: copyElsewhere.project,
        machine: copyElsewhere.machine,
      })
    else events.emit('messages:open', { message: id })
  }
  const first = message?.text.split('\n', 1)[0]
  return (
    <a
      className={chip}
      data-conversation-mention
      data-message-mention={id}
      href={`?message=${id}`}
      onClick={open}
      title={
        message
          ? `Open message ${id}${copyElsewhere ? ` in ${copyElsewhere.project}'s Ultimate` : ''}${first ? `: ${first.slice(0, 120)}` : ''}`
          : undefined
      }
    >
      {children}
    </a>
  )
}
