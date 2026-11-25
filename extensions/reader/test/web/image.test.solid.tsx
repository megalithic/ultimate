import { settle } from '@ui-sdk/core/testing'
import { flush } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { Markdown } from '@/components/markdown/markdown.solid.tsx'
import type { ActionRef } from '../../../../shared/extension-api.ts'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'
import { localLinks } from '../../blocks.ts'
import { PathImage } from '../../image.solid.tsx'
import { InReadFile } from '../../link.solid.tsx'

const calls = vi.hoisted(() => [] as unknown[])
vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createReads } = await import('../../../../web/src/sdk/reads.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  const store = createStore()
  vi.spyOn(store, 'watchRead').mockImplementation((spec, _every, answer) => {
    calls.push(spec)
    answer({ result: { data: 'aW1hZ2U=', mimeType: 'image/png' } })
    return () => {}
  })
  return {
    store,
    api: {},
    uiState: createUiState(undefined),
    registry: createRegistry(),
    reads: createReads(async <Args, Result>(ref: ActionRef<Args, Result>, args?: Args) => {
      calls.push({ ref, args })
      return { result: { data: 'aW1hZ2U=', mimeType: 'image/png' } as Result }
    }, store),
  }
})

import { registry } from '../../../../web/src/sdk/client.ts'

it('loads a read file image as a data URL, leaving the same chat image alone', async () => {
  await registry.setLoaders({
    '/extensions/reader/web.solid.tsx': async () => ({ default: { image: PathImage } }),
  })
  const text = localLinks('![shot](./img/x.png)', '/project/docs')
  const view = renderSolid(() => (
    <>
      <InReadFile value={true}>
        <Markdown text={text} />
      </InReadFile>
      <Markdown text={text} />
    </>
  ))
  await settle()
  flush()
  const images = view.querySelectorAll('img')
  expect(images[0].getAttribute('src')).toBe('data:image/png;base64,aW1hZ2U=')
  expect(images[0].alt).toBe('shot')
  expect(images[1].getAttribute('src')).toBe('/project/docs/img/x.png')
  expect(calls).toMatchObject([{ args: { path: '/project/docs/img/x.png' } }])
})
