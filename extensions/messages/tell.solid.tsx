import { Send } from '@lucide/solid'
import { Show } from 'solid-js'
import { Card } from '@/sdk/solid'
import { Answers, Body, Navigate } from './card-parts.solid.tsx'
import { outgoingState, remoteLabel } from './data.ts'
import { openElsewhere } from './elsewhere.solid.tsx'
import type { Message, Remote } from './refs.ts'
import { Address } from './ui.solid.tsx'

export function OpenElsewhere(props: { remote: Remote }) {
  return (
    <Show when={props.remote.id !== undefined}>
      <Navigate
        aria-label={`Open message ${props.remote.id} in ${remoteLabel(props.remote)}`}
        class="ms-auto"
        data-open-elsewhere={props.remote.id}
        onClick={() =>
          openElsewhere({
            message: props.remote.id!,
            project: props.remote.project,
            machine: props.remote.machine,
          })
        }
      >
        open in {props.remote.project}
      </Navigate>
    </Show>
  )
}

export function TellCard(props: { message: Message }) {
  const state = () => outgoingState(props.message, false, false)
  return (
    <Card data-message-outgoing={props.message.id}>
      <header class="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <Send class="size-3.5 text-brand" />
        <span>Message to</span>
        <span class="flex min-w-0 text-foreground">
          <Address id="remote" remote={props.message.remote} />
        </span>
        <span>{props.message.reply ? 'expects reply' : 'one-way'}</span>
        <Show when={state()}>
          {(value) => (
            <span class={value() === 'failed' ? 'text-destructive' : ''}>· {value()}</span>
          )}
        </Show>
        <Show when={props.message.remote}>{(remote) => <OpenElsewhere remote={remote()} />}</Show>
      </header>
      <Show when={props.message.error}>
        {(error) => (
          <p class="border-b border-border/60 px-3 py-1.5 font-mono text-[11px] break-words text-destructive">
            {error()}
          </p>
        )}
      </Show>
      <Body text={props.message.text} />
      <Answers message={props.message} />
    </Card>
  )
}
