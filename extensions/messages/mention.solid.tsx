import type { JSX } from '@solidjs/web'
import { Show, createMemo } from 'solid-js'
import { parseMessageMention, parseRemoteMessageMention } from '@/components/ai/mentions.ts'
import { events, ROOT, useDocOf } from '@/sdk/solid'
import { cardOf } from './caller.ts'
import { openElsewhere } from './elsewhere.solid.tsx'
import { MessagesDoc } from './refs.ts'

const chip =
  'mx-px rounded-sm px-0.5 font-mono text-[0.92em] text-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-2 transition-colors outline-none hover:bg-accent focus-visible:bg-accent'

export function MessageMentionLink(props: {
  href: string
  children: JSX.Element
  core: JSX.Element
}) {
  const id = createMemo(() => parseMessageMention(props.href))
  const elsewhere = createMemo(() => parseRemoteMessageMention(props.href))
  const log = useDocOf(() => ROOT, MessagesDoc)
  const message = createMemo(() => log()?.messages.find((m) => m.id === id()))
  const copyElsewhere = createMemo(() => {
    const item = message()
    return item && !cardOf(item) && item.remote?.id !== undefined ? item.remote : undefined
  })
  const first = () => message()?.text.split('\n', 1)[0]
  return (
    <Show
      when={elsewhere()}
      fallback={
        <Show when={id() !== undefined} fallback={props.core}>
          <a
            class={chip}
            data-conversation-mention
            data-message-mention={id()}
            href={`?message=${id()}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const copy = copyElsewhere()
              if (copy)
                void openElsewhere({
                  message: copy.id!,
                  project: copy.project,
                  machine: copy.machine,
                })
              else events.emit('messages:open', { message: id() })
            }}
            title={
              message()
                ? `Open message ${id()}${copyElsewhere() ? ` in ${copyElsewhere()!.project}'s Ultimate` : ''}${first() ? `: ${first()!.slice(0, 120)}` : ''}`
                : undefined
            }
          >
            {props.children}
          </a>
        </Show>
      }
    >
      {(target) => (
        <a
          class={chip}
          data-conversation-mention
          data-message-elsewhere={`${target().message}@${target().project}${target().machine ? ` on ${target().machine}` : ''}`}
          href={`?message=${target().message}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void openElsewhere(target())
          }}
          title={`Open message ${target().message} in ${target().project}${target().machine ? ` on ${target().machine}` : ''}'s Ultimate`}
        >
          {props.children}
        </a>
      )}
    </Show>
  )
}
