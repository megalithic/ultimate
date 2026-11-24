import { ChevronRight } from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible.solid.tsx'
import { cn } from '@/sdk/solid'
import { useSidebarState } from './state.solid.tsx'

export function Section(props: {
  id: string
  label: string
  count: number
  action?: JSX.Element
  children: JSX.Element
}) {
  const [closed, setClosed] = useSidebarState<string[]>('closedSections', [])
  const open = () => !closed().includes(props.id)
  return (
    <Collapsible
      bind={[
        open,
        (next) => {
          const id = props.id
          setClosed((previous) => [...previous.filter((key) => key !== id), ...(next ? [] : [id])])
        },
      ]}
      class="flex flex-col gap-0.5"
      data-sidebar-section={props.id}
    >
      <div class="mx-2 flex items-center">
        <CollapsibleTrigger
          aria-label={props.label}
          class="group/section flex h-7 flex-1 items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          data-ui="sidebar-section-header"
        >
          <ChevronRight class="size-3 transition-transform group-data-open/section:rotate-90" />
          {props.label}
          <span class="text-muted-foreground/60 tabular-nums">{props.count}</span>
        </CollapsibleTrigger>
        <Show when={open()}>{props.action}</Show>
      </div>
      <CollapsibleContent class="flex flex-col gap-0.5">{props.children}</CollapsibleContent>
    </Collapsible>
  )
}

export function More(props: {
  hidden: number
  all?: boolean
  label: string
  onToggle: () => void
  class?: string
}) {
  return (
    <Button
      aria-label={
        props.all ? `Show fewer ${props.label}` : `Show ${props.hidden} more ${props.label}`
      }
      class={cn(
        'mx-2 h-6 justify-start rounded-md pl-[26px] text-left font-mono text-[10px] font-normal text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
        props.class,
      )}
      onClick={props.onToggle}
      size={null}
      variant={null}
    >
      {props.all ? 'fewer' : `+${props.hidden} more`}
    </Button>
  )
}
