import { ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/sdk'
import { useSidebarState } from './state.tsx'

export function Section({
  id,
  label,
  count,
  rule,
  action,
  children,
}: {
  id: string
  label: string
  count: number
  rule?: boolean
  action?: ReactNode
  children: ReactNode
}) {
  const [closed, setClosed] = useSidebarState<string[]>('closedSections', [])
  const open = !closed.includes(id)
  return (
    <Collapsible
      aria-label={label}
      className={cn('flex flex-col gap-0.5', rule && 'mb-2 border-b border-border/60 pb-2')}
      data-sidebar-section={id}
      onOpenChange={(next) =>
        setClosed((previous) => [...previous.filter((key) => key !== id), ...(next ? [] : [id])])
      }
      open={open}
    >
      <div className="mx-2 flex items-center">
        <CollapsibleTrigger
          className="group/section flex h-7 flex-1 cursor-pointer items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          data-ui="sidebar-section-header"
        >
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/section:rotate-90" />
          {label}
          <span className="text-muted-foreground/60 tabular-nums">{count}</span>
        </CollapsibleTrigger>
        {open && action}
      </div>
      <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function More({
  hidden,
  all,
  onToggle,
}: {
  hidden: number
  all: boolean
  onToggle: () => void
}) {
  return (
    <button
      className="mx-2 h-6 cursor-pointer rounded-md pl-[26px] text-left font-mono text-[10px] text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onToggle}
      type="button"
    >
      {all ? 'fewer' : `+${hidden} more`}
    </button>
  )
}
