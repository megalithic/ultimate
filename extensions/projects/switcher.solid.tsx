import { Check, ChevronDown, Laptop, Play } from '@lucide/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.solid.tsx'
import {
  ROOT,
  api,
  cn,
  errorMessage,
  formatAgo,
  keepLast,
  notify,
  prettyName,
  useAction,
  usePageVisible,
  useSystem,
  useViewport,
} from '@/sdk/solid'
import { ProjectSwatch } from '../sidebar/ui.solid.tsx'
import { target } from './links.ts'
import { ListAction, RemotesAction, StartAction, StoppedAction } from './refs.ts'
import type { RemoteProject, RunningProject, StoppedProject } from './refs.ts'

const VISIBLE_POLL_MS = 4_000
const REMOTE_POLL_MS = 15_000

const machineChip =
  'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 font-mono text-[11.5px] text-muted-foreground'

export function TitlebarMachine() {
  const viewport = useViewport()
  const system = useSystem()
  const machine = () => system()?.machine.hostname.split('.')[0]
  return (
    <Show when={machine()}>
      {(name) => (
        <Show
          when={viewport() === 'phone'}
          fallback={
            <span class={machineChip} title={`This Ultimate runs on ${name()}`}>
              <Laptop aria-hidden="true" class="size-3.5 shrink-0 opacity-60" />
              <span class="truncate">{name()}</span>
            </span>
          }
        >
          <PhoneSwitcher machine={name()} />
        </Show>
      )}
    </Show>
  )
}

function PhoneSwitcher(props: { machine: string }) {
  const system = useSystem()
  const visible = usePageVisible()
  const [openings, setOpenings] = createSignal(0)
  const poll = (ms: number) => () => (visible() ? ms : undefined)
  const options = { conversation: ROOT, onError: keepLast, on: openings }
  const list = useAction(ListAction, null, { ...options, every: poll(VISIBLE_POLL_MS) })
  const stoppedList = useAction(StoppedAction, null, { ...options, every: poll(VISIBLE_POLL_MS) })
  const remoteList = useAction(RemotesAction, null, { ...options, every: poll(REMOTE_POLL_MS) })
  const running = () => list.data() ?? []
  const stopped = () => stoppedList.data() ?? []
  const remote = () => remoteList.data() ?? []
  const family = createMemo(() => [...running(), ...stopped()].map((project) => project.name))
  const here = () => running().find((project) => project.current)
  const name = () => prettyName(here()?.name ?? system()?.project.name ?? '')
  const waitingElsewhere = createMemo(
    () =>
      running().reduce(
        (sum, project) => sum + (project.current ? 0 : (project.questions ?? 0)),
        0,
      ) + remote().reduce((sum, project) => sum + (project.questions ?? 0), 0),
  )
  const [starting, setStarting] = createSignal<string>()
  const start = async (project: StoppedProject) => {
    setStarting(project.home)
    try {
      const { output } = await api.action(StartAction, { home: project.home })
      notify({ level: 'info', message: output || `Started ${prettyName(project.name)}` })
      await Promise.all([list.refetch(), stoppedList.refetch()])
    } catch (error) {
      notify({ level: 'error', message: errorMessage(error) })
    } finally {
      setStarting(undefined)
    }
  }
  const choose = (value: string) => {
    const project = stopped().find((candidate) => `start:${candidate.home}` === value)
    return project ? start(project) : undefined
  }
  return (
    <DropdownMenu
      modal={false}
      onAction={choose}
      onOpenChange={(open) => open && setOpenings((count) => count + 1)}
    >
      <DropdownMenuTrigger
        aria-label={`Switch project: ${name()} on ${props.machine}${waitingElsewhere() ? `, ${waitingElsewhere()} waiting elsewhere` : ''}`}
        class={cn(
          machineChip,
          'shrink-0 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-open:bg-accent',
        )}
        data-ui="project-switcher"
      >
        <span class="truncate">{props.machine}</span>
        <Show when={waitingElsewhere() > 0}>
          <Count value={waitingElsewhere()} />
        </Show>
        <ChevronDown aria-hidden="true" class="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-[min(22rem,calc(100vw-1rem))]">
        <DropdownMenuGroup>
          <DropdownMenuLabel class="section-label px-2 pt-1 pb-1.5">This Mac</DropdownMenuLabel>
          <For each={running()} keyed={(project) => project.url}>
            {(project) => <RunningItem family={family()} project={project()} />}
          </For>
        </DropdownMenuGroup>
        <Show when={remote().length > 0}>
          <DropdownMenuGroup>
            <DropdownMenuLabel class="section-label px-2 pt-2.5 pb-1.5">
              Other machines
            </DropdownMenuLabel>
            <For each={remote()} keyed={(project) => `${project.machine}/${project.name}`}>
              {(project) => <RemoteItem project={project()} />}
            </For>
          </DropdownMenuGroup>
        </Show>
        <Show when={stopped().length > 0}>
          <DropdownMenuGroup>
            <DropdownMenuLabel class="section-label px-2 pt-2.5 pb-1.5">Stopped</DropdownMenuLabel>
            <For each={stopped()} keyed={(project) => project.home}>
              {(project) => (
                <StoppedItem
                  family={family()}
                  project={project()}
                  starting={starting() === project().home}
                />
              )}
            </For>
          </DropdownMenuGroup>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Count(props: { value: number }) {
  return (
    <span class="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-1 font-mono text-[10px] font-semibold text-amber-700 tabular-nums ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
      {props.value}
    </span>
  )
}

function State(props: { questions?: number; busy?: number }) {
  return (
    <Show
      when={(props.questions ?? 0) > 0}
      fallback={
        <Show when={(props.busy ?? 0) > 0}>
          <span class="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand" />
        </Show>
      }
    >
      <Count value={props.questions!} />
    </Show>
  )
}

const describe = (parts: (string | false | undefined | 0)[]) => parts.filter(Boolean).join(' · ')

function Item(props: {
  label: string
  href?: string
  value: string
  disabled?: boolean
  children: JSX.Element
}) {
  return (
    <Show
      when={props.href}
      fallback={
        <DropdownMenuItem
          aria-label={props.label}
          class="gap-2.5 py-2"
          disabled={props.disabled}
          value={props.value}
        >
          {props.children}
        </DropdownMenuItem>
      }
    >
      {(href) => (
        <DropdownMenuItem
          aria-label={props.label}
          class="gap-2.5 py-2"
          render={(item) => (
            <a {...item} href={href()}>
              {item.children}
            </a>
          )}
          value={props.value}
        >
          {props.children}
        </DropdownMenuItem>
      )}
    </Show>
  )
}

function Name(props: { name: string; detail?: string; muted?: boolean; current?: boolean }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span
        class={cn(
          'truncate text-[14px] leading-5',
          props.current ? 'font-semibold text-foreground' : 'text-foreground/90',
          props.muted && 'text-muted-foreground',
        )}
      >
        {props.name}
      </span>
      <Show when={props.detail}>
        <span class="truncate font-mono text-[10.5px] leading-4 text-muted-foreground/80">
          {props.detail}
        </span>
      </Show>
    </span>
  )
}

function RunningItem(props: { project: RunningProject; family: readonly string[] }) {
  const href = () => (props.project.current ? undefined : target(props.project, location))
  const unreachable = () => !props.project.current && !href()
  const name = () => prettyName(props.project.name)
  return (
    <Item
      disabled={props.project.current || unreachable()}
      href={href()}
      label={describe([
        `Open ${name()}`,
        props.project.hub && 'hub',
        props.project.current && 'this page',
        unreachable() && 'not on the tailnet',
        (props.project.questions ?? 0) > 0 && `${props.project.questions} for you`,
        (props.project.busy ?? 0) > 0 && 'working',
      ])}
      value={`open:${props.project.url}`}
    >
      <ProjectSwatch
        class="h-7 w-1.5 rounded-full"
        family={props.family}
        folder={props.project.name}
      />
      <Name
        current={props.project.current}
        detail={describe([
          props.project.hub && 'hub',
          props.project.repo?.name,
          unreachable() && 'not on the tailnet',
        ])}
        name={name()}
      />
      <State busy={props.project.busy} questions={props.project.questions} />
      <Show when={props.project.current}>
        <Check aria-hidden="true" class="size-4 text-brand" />
      </Show>
    </Item>
  )
}

function RemoteItem(props: { project: RemoteProject }) {
  const name = () => prettyName(props.project.name)
  const answered = () => props.project.questions !== undefined
  return (
    <Item
      href={`${props.project.url}/`}
      label={describe([
        `Open ${name()} on ${props.project.machine}`,
        !answered() && 'not answering',
        (props.project.questions ?? 0) > 0 && `${props.project.questions} for you`,
        (props.project.busy ?? 0) > 0 && 'working',
      ])}
      value={`remote:${props.project.machine}/${props.project.name}`}
    >
      <ProjectSwatch class="h-7 w-1.5 rounded-full" folder={props.project.name} />
      <Name
        detail={describe([props.project.machine, !answered() && 'not answering'])}
        muted={!answered()}
        name={name()}
      />
      <State busy={props.project.busy} questions={props.project.questions} />
    </Item>
  )
}

function StoppedItem(props: {
  project: StoppedProject
  family: readonly string[]
  starting: boolean
}) {
  const name = () => prettyName(props.project.name)
  const ago = () =>
    props.project.lastActive && formatAgo(props.project.lastActive, Date.now(), { ago: true })
  return (
    <Item
      disabled={!props.project.root || props.starting}
      label={`Start ${name()}`}
      value={`start:${props.project.home}`}
    >
      <ProjectSwatch
        class={cn(
          'h-7 w-1.5 rounded-full opacity-30',
          props.starting && 'animate-pulse-dot opacity-70',
        )}
        family={props.family}
        folder={props.project.name}
      />
      <Name
        detail={
          props.starting ? 'starting…' : describe([props.project.hub && 'hub', ago() || undefined])
        }
        muted
        name={name()}
      />
      <span class="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Play aria-hidden="true" class="size-3.5" />
        start
      </span>
    </Item>
  )
}
