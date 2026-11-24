import { Play, X } from '@lucide/solid'
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { api, cn, errorMessage, formatAgo, prettyName } from '@/sdk/solid'
import { ProjectSwatch, RepoLabel } from '../sidebar/ui.solid.tsx'
import { ForgetAction, StartAction } from './refs.ts'
import type { StoppedProject } from './refs.ts'

export function HubTag() {
  return (
    <span class="shrink-0 rounded-sm px-1 font-mono text-[9px] leading-3.5 tracking-wider text-brand uppercase ring-1 ring-brand/40 ring-inset">
      hub
    </span>
  )
}

export function StoppedRow(props: {
  project: StoppedProject
  wide: boolean
  family: readonly string[]
  refresh: () => Promise<unknown>
}) {
  const [doing, setDoing] = createSignal<'starting' | 'forgetting'>()
  const [error, setError] = createSignal<string>()
  const [started, setStarted] = createSignal<string>()
  const name = () => prettyName(props.project.name)
  const ago = () =>
    props.project.lastActive && formatAgo(props.project.lastActive, Date.now(), { ago: true })
  const title = createMemo(() =>
    [
      name(),
      props.project.hub && 'hub',
      props.project.repo?.name,
      'stopped',
      ago() && `last active ${ago()}`,
      started(),
      error(),
    ]
      .filter(Boolean)
      .join(' · '),
  )
  const run = async (what: 'starting' | 'forgetting') => {
    setDoing(what)
    setError(undefined)
    setStarted(undefined)
    try {
      if (what === 'starting') {
        const { output } = await api.action(StartAction, { home: props.project.home })
        setStarted(output)
      } else await api.action(ForgetAction, { home: props.project.home })
      await props.refresh()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setDoing(undefined)
    }
  }
  return (
    <div
      class={cn(
        'group relative mx-1.5 flex h-10 items-center rounded-lg',
        props.wide && 'hover:bg-sidebar-accent/40',
      )}
      data-project={props.project.name}
      title={title()}
    >
      <span class="flex h-full w-11 shrink-0 justify-center py-px">
        <span class="relative flex h-full w-5 justify-center">
          <ProjectSwatch
            class={cn(
              'h-full w-3 rounded-md opacity-25 group-hover:opacity-45',
              doing() === 'starting' && 'animate-pulse-dot opacity-70',
            )}
            family={props.family}
            folder={props.project.name}
          />
        </span>
      </span>
      <Show when={props.wide}>
        <span class="flex min-w-0 flex-1 items-center gap-1 pe-1.5 ps-1.5">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-[13px] leading-5 text-muted-foreground">{name()}</span>
              <Show when={props.project.hub}>
                <HubTag />
              </Show>
            </span>
            <span class="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/60">
              <Switch
                fallback={
                  <>
                    <Show when={props.project.repo}>
                      {(repo) => <RepoLabel class="min-w-0 opacity-70" repo={repo()} />}
                    </Show>
                    <Show when={ago()}>{(text) => <span class="shrink-0">{text()}</span>}</Show>
                  </>
                }
              >
                <Match when={doing()}>
                  <span class="text-brand">{doing()}…</span>
                </Match>
                <Match when={error()}>
                  <span class="truncate text-error">{error()}</span>
                </Match>
                <Match when={started()}>
                  <span class="truncate text-brand">{started()}</span>
                </Match>
              </Switch>
            </span>
          </span>
          <Show when={!doing()}>
            <span class="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
              <Show when={props.project.root}>
                <Button
                  aria-label={`Start ${name()}`}
                  class="text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                  onClick={() => run('starting')}
                  size="icon-xs"
                  title={`Start ${name()}`}
                  variant="ghost"
                >
                  <Play class="size-3.5" />
                </Button>
              </Show>
              <Button
                aria-label={`Forget ${name()} until it runs again (keeps its conversations)`}
                class="text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                onClick={() => run('forgetting')}
                size="icon-xs"
                title={`Forget ${name()} until it runs again (keeps its conversations)`}
                variant="ghost"
              >
                <X class="size-3.5" />
              </Button>
            </span>
          </Show>
        </span>
      </Show>
    </div>
  )
}

export function StoppedHeading(props: { wide: boolean; count: number }) {
  return (
    <div class="mx-1.5 flex h-5 items-center [margin-block-start:--spacing(3)] [margin-block-end:--spacing(1)]">
      <span class="flex w-11 shrink-0 justify-center">
        <span class="h-px w-4 bg-border" />
      </span>
      <Show when={props.wide}>
        <span class="section-label ps-1.5">Stopped</span>
        <span class="ms-1.5 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
          {props.count}
        </span>
      </Show>
    </div>
  )
}
