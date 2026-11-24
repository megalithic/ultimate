import { SparklesIcon } from '@lucide/solid'
import { createSignal, onCleanup, onSettled, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { composerDraft } from '@/sdk/solid'

type DraftChoice = 'keep' | 'include' | 'without'
export type SentDraft = { text: string; revision: number }
type DraftGuard = {
  how: 'discard' | 'inject'
  text: boolean
  attachments: number
  onDeparture: DraftChoice
  settle: (choice: DraftChoice) => void
}

export function createDraftGuard(side: () => number) {
  const [guard, setGuard] = createSignal<DraftGuard>()
  let pending: DraftGuard | undefined
  let paneOpen = true
  const leave = () => {
    const left = pending
    pending = undefined
    left?.settle(left.onDeparture)
    setGuard(undefined)
  }
  const pageLeaves = () => {
    paneOpen = false
    leave()
  }
  const pageReturns = () => {
    paneOpen = true
  }
  onSettled(() => {
    window.addEventListener('pagehide', pageLeaves)
    window.addEventListener('pageshow', pageReturns)
  })
  onCleanup(() => {
    paneOpen = false
    window.removeEventListener('pagehide', pageLeaves)
    window.removeEventListener('pageshow', pageReturns)
    leave()
  })
  const settle = (choice: DraftChoice) => {
    const current = pending
    pending = undefined
    setGuard(undefined)
    current?.settle(choice)
  }
  const guarded = (
    how: 'discard' | 'inject',
    go: (draft?: SentDraft, leaving?: boolean) => Promise<unknown>,
    {
      departing = false,
      onDeparture = 'keep',
    }: { departing?: boolean; onDeparture?: DraftChoice } = {},
  ) => {
    const draft = composerDraft(side())
    if (!draft) return go()
    const sent = { text: draft.text, revision: draft.revision }
    if (departing || !paneOpen) return go(draft.text.trim() ? sent : undefined, true)
    settle('keep')
    return new Promise<unknown>((resolve, reject) => {
      pending = {
        how,
        onDeparture,
        attachments: draft.images + draft.files,
        text: draft.text.trim() !== '',
        settle: (choice) => {
          if (choice === 'keep')
            return reject(new Error('Nothing was sent: your draft is still there'))
          go(choice === 'include' ? sent : undefined, !paneOpen).then(resolve, reject)
        },
      }
      setGuard(pending)
    })
  }
  return { guard, guarded, settle }
}

export function DraftGuardRow(props: {
  guard: DraftGuard
  phone: boolean
  settle: (choice: DraftChoice) => void
}) {
  const inject = () => props.guard.how === 'inject'
  return (
    <div class="flex flex-wrap items-center justify-end gap-2" data-draft-guard role="alert">
      <span class="mie-auto min-w-0 font-mono text-[11px] text-warning">
        {props.phone
          ? 'Unsent draft'
          : inject()
            ? `Unsent draft in the composer${props.guard.attachments ? ' · attachments stay out' : ''}`
            : 'Unsent draft · Discard loses it'}
      </span>
      <Button autofocus onClick={() => props.settle('keep')} size="sm" variant="ghost">
        Keep editing
      </Button>
      <Show when={inject() && props.guard.text}>
        <Button
          class="border-brand/50 text-foreground hover:border-brand"
          onClick={() => props.settle('include')}
          size="sm"
          title="Quote the draft word for word under the summary"
          variant="outline"
        >
          <SparklesIcon class="text-brand" />
          Include draft
        </Button>
      </Show>
      <Button
        class="text-muted-foreground"
        data-agent-confirm={inject() ? undefined : 'Discards this side chat and its unsent draft.'}
        onClick={() => props.settle('without')}
        size="sm"
        title={inject() ? 'Summarize without the draft; it stays in this composer' : undefined}
        variant="ghost"
      >
        {inject() ? 'Without it' : 'Discard anyway'}
      </Button>
    </div>
  )
}
