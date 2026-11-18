import { debounce, deadline, every } from '../../lib/timers.ts'
import type { Cancel } from '../../lib/timers.ts'
import { PinIcon, PinOffIcon, PlayIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  api,
  cn,
  defineWebExtension,
  errorMessage,
  formatAgo,
  prettyName,
  keepLast,
  useAction,
  useExtensions,
  useViewport,
} from '@/sdk'
import { ProjectSwatch, RepoLabel, stemOf } from '../sidebar/ui.tsx'
import { shownPort, target } from './links.ts'
import { ForgetAction, ListAction, PinAction, StartAction, StoppedAction } from './refs.ts'
import type { RunningProject, StoppedProject } from './refs.ts'

const RAIL = 56
const WIDE = 272
const VISIBLE_PROJECTS_POLL_MS = 4_000
const SHARED_PIN_POLL_MS = 30_000
const NAVIGATION_EXPIRY_MS = 15_000
const pixelAlignedAxis = 'relative flex h-full w-5 justify-center'
const titleBarAlignedHeader = 'flex h-9 shrink-0 items-center border-b border-border/70'
const statusLineAlignedFooter =
  'flex h-7 shrink-0 items-center border-t border-border/70 font-mono text-[10px] text-muted-foreground/70 md:pointer-coarse:box-content md:pointer-coarse:pb-3'

let pendingNavigation: string | undefined
let cancelNavigationExpiry: Cancel | undefined
const listeners = new Set<() => void>()
const setOpening = (url: string | undefined) => {
  pendingNavigation = url
  cancelNavigationExpiry?.()
  if (url) cancelNavigationExpiry = deadline(NAVIGATION_EXPIRY_MS, () => setOpening(undefined))
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const useOpening = () => useSyncExternalStore(subscribe, () => pendingNavigation)
if (typeof window !== 'undefined') window.addEventListener('pageshow', () => setOpening(undefined))

function OpeningBar() {
  if (!useOpening()) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-sweep bg-brand/30 bg-size-[300%_100%] bg-no-repeat bg-[linear-gradient(90deg,transparent_30%,var(--color-brand)_50%,transparent_70%)]"
    />
  )
}

function useVisiblePoll(refetch: () => Promise<unknown>, interval: number, off = false) {
  useEffect(() => {
    if (off) return undefined
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      void refetch()
    }
    const stopPolling = every(interval, visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refetch, interval, off])
}

function useSharedPin(off: boolean) {
  const shared = useAction(PinAction, {}, { onError: keepLast, enabled: !off })
  useVisiblePoll(shared.refetch, SHARED_PIN_POLL_MS, off)
  const [pinned, setPinned] = useState<boolean>()
  const stored = shared.data?.pinned
  useEffect(() => {
    if (stored !== undefined) setPinned(stored)
  }, [stored])
  const set = (next: boolean) => {
    setPinned(next)
    api.action(PinAction, { pinned: next }).catch(keepLast)
  }
  return [pinned ?? false, set] as const
}

function Detail({ project, pending }: { project: RunningProject; pending: boolean }) {
  if (pending) return <span className="text-brand">opening…</span>
  return (
    <>
      {project.repo && <RepoLabel className="min-w-0" repo={project.repo} />}
      <span className="shrink-0 text-muted-foreground/50">{shownPort(project, location)}</span>
    </>
  )
}

function HubTag() {
  return (
    <span className="shrink-0 rounded-sm px-1 font-mono text-[9px] leading-3.5 tracking-wider text-brand uppercase ring-1 ring-brand/40 ring-inset">
      hub
    </span>
  )
}

function State({ busy, questions }: { busy: boolean; questions: number }) {
  if (questions > 0)
    return (
      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-1.5 font-mono text-[10px] font-semibold text-amber-700 tabular-nums ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
        {questions}
      </span>
    )
  if (busy) return <span className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand" />
  return null
}

function Row({
  project,
  wide,
  first,
  last,
  family,
}: {
  project: RunningProject
  wide: boolean
  first: boolean
  last: boolean
  family: readonly string[]
}) {
  const here = project.current
  const pending = useOpening() === project.url
  const busy = (project.busy ?? 0) > 0
  const questions = project.questions ?? 0
  const name = prettyName(project.name)
  const href = here ? undefined : target(project, location)
  const unreachable = !here && !href
  const title = [
    name,
    project.hub && 'hub',
    project.repo?.name,
    shownPort(project, location),
    unreachable && 'not on the tailnet',
    questions && `${questions} for you`,
    busy && 'working',
    here && 'this tab',
    pending && 'opening',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <a
      aria-current={here ? 'page' : undefined}
      aria-label={title}
      className={cn(
        'group relative mx-1.5 flex h-10 items-center rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        here || unreachable ? 'cursor-default' : 'cursor-pointer',
        unreachable && 'opacity-45',
        wide && (here ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'),
      )}
      data-project={project.name}
      href={href}
      onClick={(event) => {
        const skipsTabNavigation =
          here ||
          unreachable ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        if (skipsTabNavigation) return
        setOpening(project.url)
      }}
      title={title}
    >
      <span
        className={cn(
          'absolute -left-1.5 w-[3px] rounded-r-full transition-all duration-150',
          here || pending ? 'h-6 bg-brand' : 'h-0 bg-muted-foreground/60 group-hover:h-3',
          pending && 'animate-pulse-dot',
        )}
      />
      <span
        className={cn(
          'flex h-full w-11 shrink-0 justify-center',
          !first && 'pt-px',
          !last && 'pb-px',
        )}
      >
        <span className={pixelAlignedAxis}>
          <ProjectSwatch
            className={cn(
              'h-full transition-[width,opacity] duration-150',
              here || pending ? 'w-5' : 'w-3 opacity-70 group-hover:w-4 group-hover:opacity-100',
              here && 'outline-1 outline-offset-2 outline-foreground/45',
              first ? 'rounded-t-md' : 'rounded-t-[1px]',
              last ? 'rounded-b-md' : 'rounded-b-[1px]',
              pending && 'animate-pulse-dot',
            )}
            family={family}
            folder={project.name}
          />
          {!wide && questions > 0 && (
            <span className="absolute inset-0 m-auto flex h-4 w-fit min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 font-mono text-[9.5px] leading-none font-semibold text-black tabular-nums ring-2 ring-sidebar">
              {questions}
            </span>
          )}
          {!wide && busy && questions === 0 && (
            <span className="absolute inset-0 m-auto size-2 animate-pulse-dot rounded-full bg-brand ring-2 ring-sidebar" />
          )}
        </span>
      </span>
      {wide && (
        <span className="flex min-w-0 flex-1 items-center gap-2 pr-2.5 pl-1.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[13px] leading-5',
                  here ? 'font-semibold text-foreground' : 'text-foreground/85',
                )}
              >
                {name}
              </span>
              {project.hub && <HubTag />}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/80">
              <Detail pending={pending} project={project} />
            </span>
          </span>
          <State busy={busy} questions={questions} />
        </span>
      )}
    </a>
  )
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function StoppedRow({
  project,
  wide,
  family,
  refresh,
}: {
  project: StoppedProject
  wide: boolean
  family: readonly string[]
  refresh: () => Promise<unknown>
}) {
  const [doing, setDoing] = useState<'starting' | 'forgetting'>()
  const [error, setError] = useState<string>()
  const [started, setStarted] = useState<string>()
  const name = prettyName(project.name)
  const ago = project.lastActive && formatAgo(project.lastActive, Date.now(), { ago: true })
  const title = [
    name,
    project.hub && 'hub',
    project.repo?.name,
    'stopped',
    ago && `last active ${ago}`,
    started,
    error,
  ]
    .filter(Boolean)
    .join(' · ')
  const run = (what: 'starting' | 'forgetting') => {
    setDoing(what)
    setError(undefined)
    setStarted(undefined)
    const action =
      what === 'starting'
        ? api.action(StartAction, { home: project.home }).then(({ output }) => setStarted(output))
        : api.action(ForgetAction, { home: project.home })
    action
      .then(refresh)
      .catch((failed: unknown) => setError(errorMessage(failed)))
      .finally(() => setDoing(undefined))
  }
  return (
    <div
      aria-label={title}
      className={cn(
        'group relative mx-1.5 flex h-10 items-center rounded-lg',
        wide && 'hover:bg-sidebar-accent/40',
      )}
      data-project={project.name}
      title={title}
    >
      <span className="flex h-full w-11 shrink-0 justify-center py-px">
        <span className={pixelAlignedAxis}>
          <ProjectSwatch
            className={cn(
              'h-full w-3 rounded-md opacity-25 group-hover:opacity-45',
              doing === 'starting' && 'animate-pulse-dot opacity-70',
            )}
            family={family}
            folder={project.name}
          />
        </span>
      </span>
      {wide && (
        <span className="flex min-w-0 flex-1 items-center gap-1 pr-1.5 pl-1.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] leading-5 text-muted-foreground">{name}</span>
              {project.hub && <HubTag />}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/60">
              {doing ? (
                <span className="text-brand">{doing}…</span>
              ) : error ? (
                <span className="truncate text-destructive">{error}</span>
              ) : started ? (
                <span className="truncate text-brand">{started}</span>
              ) : (
                <>
                  {project.repo && <RepoLabel className="min-w-0 opacity-70" repo={project.repo} />}
                  {ago && <span className="shrink-0">{ago}</span>}
                </>
              )}
            </span>
          </span>
          {!doing && (
            <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
              {project.root && (
                <RowButton label={`Start ${name}`} onClick={() => run('starting')}>
                  <PlayIcon className="size-3.5" />
                </RowButton>
              )}
              <RowButton
                label={`Forget ${name} until it runs again (keeps its conversations)`}
                onClick={() => run('forgetting')}
              >
                <XIcon className="size-3.5" />
              </RowButton>
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function StoppedHeading({ wide, count }: { wide: boolean; count: number }) {
  return (
    <div className="mx-1.5 mt-3 mb-1 flex h-5 items-center">
      <span className="flex w-11 shrink-0 justify-center">
        <span className="h-px w-4 bg-border" />
      </span>
      {wide && (
        <>
          <span className="section-label pl-1.5">Stopped</span>
          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
            {count}
          </span>
        </>
      )}
    </div>
  )
}

function RailSkeleton({ wide }: { wide: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none">
      {['w-24', 'w-32', 'w-20', 'w-28'].map((name) => (
        <span className="mx-1.5 flex h-10 items-center" key={name}>
          <span className="flex h-full w-11 shrink-0 justify-center py-px">
            <Skeleton className="h-full w-3 rounded-sm bg-sidebar-accent/60" />
          </span>
          {wide && (
            <span className="flex min-w-0 flex-1 flex-col gap-1.5 pl-1.5">
              <Skeleton className={cn('h-2.5 rounded-sm bg-sidebar-accent/60', name)} />
              <Skeleton className="h-2 w-16 rounded-sm bg-sidebar-accent/40" />
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function Rail() {
  const viewport = useViewport()
  const railOccupied = useExtensions().some(
    (record) => record.name !== 'projects' && record.extension?.slots?.['shell.rail'],
  )
  const list = useAction(ListAction, null, {
    onError: keepLast,
    enabled: !railOccupied,
  })
  useVisiblePoll(list.refetch, VISIBLE_PROJECTS_POLL_MS, railOccupied)
  const stoppedList = useAction(StoppedAction, null, {
    onError: keepLast,
    enabled: !railOccupied,
  })
  useVisiblePoll(stoppedList.refetch, VISIBLE_PROJECTS_POLL_MS, railOccupied)
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useSharedPin(railOccupied)
  const [showHover] = useState(() => debounce(150, () => setHover(true)))
  useEffect(() => showHover.cancel, [showHover])
  const projects = list.data ?? []
  const stopped = stoppedList.data ?? []
  const loading = !list.data && !list.error
  const loadedAfterMount = useRef(loading).current
  const rows = projects.length + stopped.length
  if (railOccupied || viewport === 'phone' || (!loading && rows < 2)) return null

  const wide = hover || pinned
  const family = [...projects, ...stopped].map((project) => project.name)
  const refresh = () => Promise.all([list.refetch(), stoppedList.refetch()])
  const questions = projects.reduce((sum, project) => sum + (project.questions ?? 0), 0)
  const working = projects.filter((project) => (project.busy ?? 0) > 0).length

  return (
    <div className="relative shrink-0" style={{ width: pinned ? WIDE : RAIL }}>
      <nav
        aria-label="Projects"
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,box-shadow] duration-150 ease-out',
          hover && !pinned && 'shadow-2xl shadow-black/40',
        )}
        onMouseEnter={showHover}
        onMouseLeave={() => {
          showHover.cancel()
          setHover(false)
        }}
        onFocus={() => setHover(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHover(false)
        }}
        style={{ width: wide ? WIDE : RAIL }}
      >
        <div className={titleBarAlignedHeader}>
          <span className="flex w-14 shrink-0 justify-center font-mono text-[9px] tracking-[0.2em] text-brand">
            U
          </span>
          {wide && (
            <>
              <span className="section-label">Projects</span>
              <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                {projects.length || ''}
              </span>
              <button
                aria-label={pinned ? 'Unpin the projects rail' : 'Pin the projects rail open'}
                aria-pressed={pinned}
                className={cn(
                  'mr-2 ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
                  pinned ? 'text-foreground' : 'text-muted-foreground/70',
                )}
                onClick={() => setPinned(!pinned)}
                title={pinned ? 'Unpin: open on hover' : 'Pin: keep open beside the app'}
                type="button"
              >
                {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
              </button>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-2 [scrollbar-width:none]">
          {loading && <RailSkeleton wide={wide} />}
          <div className={cn('flex flex-col', loadedAfterMount && 'animate-fade-in')}>
            {projects.map((project, index) => {
              const stem = stemOf(project.name)
              const first = index === 0 || stemOf(projects[index - 1].name) !== stem
              const last = stemOf(projects[index + 1]?.name ?? '') !== stem
              return (
                <div className={cn(first && index > 0 && 'mt-2')} key={project.url}>
                  <Row family={family} first={first} last={last} project={project} wide={wide} />
                </div>
              )
            })}
            {stopped.length > 0 && <StoppedHeading count={stopped.length} wide={wide} />}
            {stopped.map((project) => (
              <StoppedRow
                family={family}
                key={project.home}
                project={project}
                refresh={refresh}
                wide={wide}
              />
            ))}
          </div>
        </div>
        <div className={statusLineAlignedFooter}>
          <span className="flex w-14 shrink-0 justify-center">
            {questions > 0 && <span className="size-1.5 rounded-full bg-amber-400" />}
          </span>
          {wide && !loading && (
            <span className="truncate">
              <span className={cn(questions > 0 && 'text-amber-700 dark:text-amber-300')}>
                {questions} for you
              </span>
              {` · ${working} working`}
            </span>
          )}
        </div>
      </nav>
    </div>
  )
}

export default defineWebExtension({
  slots: { 'shell.rail': Rail, overlay: OpeningBar },
})
