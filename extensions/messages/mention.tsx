import type { MouseEvent, ReactNode } from 'react'
import { parseMessageMention } from '@/components/ai/mentions'
import { events, ROOT, useDocOf } from '@/sdk'
import { MessagesDoc } from './refs.ts'

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
  const message = useDocOf(ROOT, MessagesDoc)?.messages.find((m) => m.id === id)
  if (id === undefined) return core
  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    events.emit('messages:open', { message: id })
  }
  const first = message?.text.split('\n', 1)[0]
  return (
    <a
      className="rounded-sm px-0.5 font-mono text-[0.92em] text-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-2 transition-colors hover:bg-accent"
      data-conversation-mention
      data-message-mention={id}
      href={`?message=${id}`}
      onClick={open}
      title={message ? `Open message ${id}${first ? `: ${first.slice(0, 120)}` : ''}` : undefined}
    >
      {children}
    </a>
  )
}
