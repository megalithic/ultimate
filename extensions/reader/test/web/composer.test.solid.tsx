import { createAgent } from '@ui-sdk/solid/agent'
import { expectDistinctAgentNames } from '../../../../test/web/agent-names.ts'
import { settle } from '@ui-sdk/core/testing'
import { api as clientApi } from '../../../../web/src/sdk/client.ts'
import type { CommentImage } from '../../comments.ts'
import { createSignal, flush, Show } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'
import { Composer } from '../../comment.solid.tsx'

vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createApi } = await import('../../../../web/src/sdk/api.ts')
  const { createReads } = await import('../../../../web/src/sdk/reads.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  const fetch = async () => Response.json({ result: { path: '/home/attachments/screen.png' } })
  const clientStore = createStore({ fetch })
  const api = createApi(clientStore, { fetch })
  return {
    api,
    reads: createReads(api, clientStore),
    registry: createRegistry(),
    reportCompact: () => {},
    store: clientStore,
    uiState: createUiState(undefined),
  }
})

vi.mock('../../images.solid.tsx', () => ({
  prepareImage: async (file: File) => ({
    image: { data: 'eA==', mimeType: file.type },
    thumb: 'data:image/jpeg;base64,eA==',
  }),
}))

it('uploads a pasted screenshot and previews it with distinct controls', async () => {
  const uploaded = vi.spyOn(clientApi, 'action')
  const [images, setImages] = createSignal<CommentImage[]>([])
  const view = renderSolid(() => (
    <Composer
      excerpt="Text"
      lines={{ start: 1, end: 1 }}
      text="Look"
      images={images()}
      onImages={setImages}
      onText={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
      submit="Add comment"
    />
  ))
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => new File(['x'], 'screen.png', { type: 'image/png' }),
        },
      ],
    },
  })
  view.querySelector('textarea')!.dispatchEvent(event)
  await settle()
  flush()
  expect(view.querySelector('img')).not.toBeNull()
  expect(uploaded).toHaveBeenCalledWith(expect.objectContaining({ extension: 'attachments' }), {
    name: 'image.png',
    data: 'eA==',
  })
  expect(view.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,eA==')
  await expectDistinctAgentNames(createAgent())
  uploaded.mockRestore()
})

it('closes the composer after Add when the browser returns a Promise from focus and scrollIntoView', ({
  onTestFinished,
}) => {
  const returnsPromise = () => Promise.resolve()
  const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(returnsPromise)
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(returnsPromise)
  onTestFinished(() => {
    focus.mockRestore()
    scroll.mockRestore()
  })
  const [open, setOpen] = createSignal(true)
  const added = vi.fn<(text: string) => void>(() => setOpen(false))
  const view = renderSolid(() => (
    <Show when={open()}>
      <Composer
        excerpt="Some text."
        lines={{ start: 3, end: 3 }}
        onCancel={() => setOpen(false)}
        onSubmit={added}
        onText={() => {}}
        submit="Add comment"
        text="Say why"
      />
    </Show>
  ))
  expect(scroll).toHaveBeenCalled()
  view.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  flush()
  expect(added).toHaveBeenCalledWith('Say why')
  expect(view.querySelector('[data-reader-composer]')).toBeNull()
})
