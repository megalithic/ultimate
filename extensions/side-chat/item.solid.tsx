import { GitForkIcon, LoaderCircleIcon } from '@lucide/solid'
import { createSignal, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { Form } from '@/components/ui/form.solid.tsx'
import { Textarea } from '@/components/ui/input.solid.tsx'
import { api, errorMessage, ROOT, useDocOf, writerNow, writingAs } from '@/sdk/solid'
import type { InboxItem } from '../inbox/ui.solid.tsx'
import { ItemSidesDoc, OpenAction } from './refs.ts'
import { useSideChatFront } from './ui.solid.tsx'

export function AskAboutItem(props: InboxItem) {
  const sides = useDocOf(() => ROOT, ItemSidesDoc)
  const [, setFront] = useSideChatFront()
  const [text, setText] = createSignal('')
  const [opening, setOpening] = createSignal(false)
  const [error, setError] = createSignal('')
  const open = () =>
    sides()?.sides.find((side) => side.item === props.key && side.ended === undefined)
  const ask = async () => {
    const conversation = props.conversation
    if (conversation === undefined || !text().trim() || opening()) return
    const who = writerNow()
    setOpening(true)
    setError('')
    try {
      const { id } = await api.action(OpenAction, {
        item: {
          key: props.key,
          conversation,
          title: props.title,
          ...(props.text ? { text: props.text } : {}),
        },
        text: text(),
      })
      setText('')
      writingAs(who, () => setFront(id))
    } catch (failure) {
      setError(errorMessage(failure).replace(/^side-chat\/\w+: /, ''))
    } finally {
      setOpening(false)
    }
  }
  return (
    <Show when={props.conversation !== undefined}>
      <Show
        when={open()}
        fallback={
          <div class="flex flex-col gap-1.5" data-ask-about-item={props.key}>
            <Form class="relative">
              <Textarea
                aria-label={`Ask about Inbox item ${props.key}`}
                autoResize
                class="max-h-40 min-h-9 resize-none border-border/70 bg-background/40 px-2.5 py-2 pe-9 leading-snug hover:border-border focus-visible:border-brand/60 focus-visible:bg-background max-md:min-h-11"
                disabled={opening()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                onValueChange={setText}
                placeholder={`Ask #${props.conversation} about this…`}
                rows={1}
                submitShortcut="enter"
                value={text()}
              />
              <Button
                aria-label={`Ask in a side chat about ${props.key}`}
                class="absolute inset-bs-1.5 inset-e-1.5 size-6 rounded p-0 text-muted-foreground hover:text-foreground"
                disabled={!text().trim() || opening()}
                onClick={ask}
                size={null}
                type="submit"
                variant="ghost"
              >
                <Show when={opening()} fallback={<GitForkIcon class="size-3.5 text-brand" />}>
                  <LoaderCircleIcon class="size-3.5 motion-safe:animate-spin" />
                </Show>
              </Button>
            </Form>
            <p class="font-mono text-[11px] text-muted-foreground/70">
              <Show
                when={error()}
                fallback={`A read-only side chat forked from #${props.conversation} · it knows what led here`}
              >
                <span class="text-error" role="alert">
                  {error()}
                </span>
              </Show>
            </p>
          </div>
        }
      >
        {(side) => (
          <Button
            aria-label={`Back to item side chat #${side().id}`}
            class="self-start text-muted-foreground"
            data-item-side-chat={side().id}
            onClick={() => setFront(side().id)}
            size="sm"
            variant="ghost"
          >
            <GitForkIcon class="text-brand" />
            Back to the side chat
          </Button>
        )}
      </Show>
    </Show>
  )
}
