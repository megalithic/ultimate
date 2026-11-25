import type { ConversationId } from '@earendil-works/pi-durable'
import { createContext, createSignal, Show, useContext } from 'solid-js'
import type { Accessor } from 'solid-js'
import { errorMessage, keepLast, ROOT, useAction } from '@/sdk/solid'
import type { ImageRenderer } from '@/sdk/solid'
import { imagePath, isLocalHref } from './blocks.ts'
import { InReadFile } from './link.solid.tsx'
import { ImageAction } from './refs.ts'

export const ImageConversation = createContext<Accessor<ConversationId | undefined>>(
  () => undefined,
)

export const PathImage: ImageRenderer = (props) => {
  const inFile = useContext(InReadFile)
  return (
    <Show
      when={inFile && isLocalHref(props.src) && props.src.startsWith('/') && props.src}
      fallback={props.core}
      keyed
    >
      {(src) => <LocalImage alt={props.alt} src={src} />}
    </Show>
  )
}

function LocalImage(props: { src: string; alt: string }) {
  const conversation = useContext(ImageConversation)
  const image = useAction(
    ImageAction,
    {
      get path() {
        return imagePath(props.src)
      },
      get conversation() {
        return conversation()
      },
    },
    { conversation: ROOT, onError: keepLast },
  )
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={!image.error() && !failed()}
      fallback={
        <span class="font-mono text-xs text-muted-foreground" title={errorMessage(image.error())}>
          Could not read image{props.alt ? `: ${props.alt}` : ''}
        </span>
      }
    >
      <Show when={image.data()}>
        {(data) => (
          <img
            alt={props.alt}
            class="h-auto max-w-full"
            onError={() => setFailed(true)}
            src={`data:${data().mimeType};base64,${data().data}`}
          />
        )}
      </Show>
    </Show>
  )
}
