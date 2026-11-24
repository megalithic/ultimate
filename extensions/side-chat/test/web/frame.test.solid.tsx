import { settle } from '@ui-sdk/core/testing'
import { createAgent } from '@ui-sdk/solid/agent'
import { flush, useContext } from 'solid-js'
import type { Component } from 'solid-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseConversationId } from '../../../../lib/ids.ts'
import type { StreamedView } from '../../../../shared/protocol.ts'
import { expectDistinctAgentNames } from '../../../../test/web/agent-names.ts'
import { FakeSource, fakeSubscriptions } from '../../../../test/web/fake-source.ts'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'

const harness = vi.hoisted(() => ({
  sources: [] as FakeSource[],
  server: undefined as ReturnType<typeof fakeSubscriptions> | undefined,
  opened: [] as { args: unknown; source: string | null }[],
  endings: [] as { action: string; args: unknown; keepalive: boolean }[],
}))
vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createApi } = await import('../../../../web/src/sdk/api.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const subscriptions = (harness.server = fakeSubscriptions(harness.sources))
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input as string
    if (path === '/api/extensions/side-chat/actions/open') {
      harness.opened.push({
        args: JSON.parse(init!.body as string).args,
        source: new Headers(init?.headers).get('x-ultimate-source'),
      })
      return Response.json({ result: { id: 82 } })
    }
    if (/\/actions\/(inject|discard)$/.test(path)) {
      harness.endings.push({
        action: path.split('/').at(-1)!,
        args: JSON.parse(init!.body as string).args,
        keepalive: !!init?.keepalive,
      })
      return Response.json({ result: { id: 82 } })
    }
    return subscriptions.handle(path, init) ?? Response.json({ ok: true, rev: 1 })
  }
  const store = createStore({
    eventSource: (url) => {
      const source = new FakeSource(url)
      harness.sources.push(source)
      return source
    },
    fetch,
  })
  return {
    store,
    api: createApi(store, { fetch }),
    registry: createRegistry(),
    reportCompact: vi.fn<(extension: string, error: unknown) => void>(),
    uiState: createUiState(undefined),
  }
})

import { store, uiState } from '../../../../web/src/sdk/client.ts'
import { ComposerRedirect, composerDraft, fillComposer } from '../../../../web/src/sdk/solid.ts'
import { AskAboutItem } from '../../item.solid.tsx'
import { ComposerFrame } from '../../frame.solid.tsx'
import web from '../../web.solid.tsx'

const agent = createAgent()
const main = 44

beforeEach(async ({ onTestFinished }) => {
  harness.sources.length = 0
  harness.opened.length = 0
  harness.endings.length = 0
  fillComposer(82, '')
  uiState.receive({})
  store.start()
  onTestFinished(() => store.stop())
  harness.sources[0].open()
  store.show(parseConversationId(main))
  await settle()
  harness.server!.of(main)!.send('view', {
    conversation: { id: main },
    entries: [],
    docs: {},
  } as unknown as StreamedView)
  await settle()
  flush()
})
afterEach(() => vi.unstubAllGlobals())

function Core() {
  const target = useContext(ComposerRedirect)
  return (
    <div>
      <textarea id="composer-input" placeholder={target()?.placeholder ?? 'To main'} />
      <button onClick={() => void target()?.send('a side question', [])} type="button">
        send
      </button>
    </div>
  )
}

async function mount() {
  const container = renderSolid(() => <ComposerFrame core={<Core />} />)
  await settle()
  harness.server!.of(1)!.send('doc', {
    kind: 'ultimate.standing-agents',
    value: { ultimate: main },
  })
  flush()
  return container
}

it('keeps an outer composer redirect while side chat mode is off', async () => {
  const outer = { placeholder: 'Sent elsewhere', send: async () => undefined }
  const container = renderSolid(() => (
    <ComposerRedirect value={() => outer}>
      <ComposerFrame core={<Core />} />
    </ComposerRedirect>
  ))
  await settle()
  harness.server!.of(1)!.send('doc', {
    kind: 'ultimate.standing-agents',
    value: { ultimate: main },
  })
  flush()
  expect(container.querySelector('[data-side-mode]')?.getAttribute('data-side-mode')).toBe('normal')
  expect(container.querySelector<HTMLTextAreaElement>('#composer-input')!.placeholder).toBe(
    'Sent elsewhere',
  )
})

it('makes main’s composer inert while a side chat is in front, with Back to main outside it', async () => {
  const container = await mount()
  harness.server!.of(main)!.send('doc', {
    kind: 'sidechat.index',
    value: { sides: [{ id: 82, at: 40, openedAt: 0 }] },
  })
  await settle()
  flush()
  const covered = () => container.querySelector('[data-main-composer]')!
  expect(covered().hasAttribute('inert')).toBe(false)
  expect(container.textContent).not.toContain('Back to main')

  uiState.set('ext.side-chat.front', 82)
  flush()
  expect(covered().hasAttribute('inert')).toBe(true)
  expect(covered().contains(container.querySelector('#composer-input'))).toBe(true)
  const back = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Back to main'),
  )!
  expect(covered().contains(back)).toBe(false)
  back.click()
  flush()
  expect(covered().hasAttribute('inert')).toBe(false)
})

it('opens the side chat in a scoped sheet and restores the main transcript when parked', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const [Stage] = web.slots!['conversation.overlay'] as Component[]
  const side = 82
  const container = renderSolid(() => (
    <div data-ui="conversation">
      <div data-main-transcript>
        <div data-ui="transcript" />
      </div>
      <Stage />
    </div>
  ))
  await settle()
  harness.server!.of(main)!.send('doc', {
    kind: 'sidechat.index',
    value: { sides: [{ id: side, at: 40, openedAt: 1 }] },
  })
  uiState.set('ext.side-chat.front', side)
  flush()
  await settle()
  expect(harness.server!.of(side)).toBeDefined()
  harness.server!.of(side)!.send('view', {
    conversation: { id: side },
    entries: [],
    docs: { sidechat: { of: main, at: 40, effects: false } },
  } as unknown as StreamedView)
  flush()
  const section = container.querySelector(`section[data-side-chat="${side}"]`)!
  const transcript = container.querySelector<HTMLElement>('[data-main-transcript]')!
  expect(section.querySelector(`#composer-input-${side}`)).not.toBeNull()
  expect(transcript.inert).toBe(true)
  section
    .querySelector<HTMLButtonElement>(`button[aria-label="Back to main, keep side chat #${side}"]`)!
    .click()
  flush()
  expect(section.hasAttribute('inert')).toBe(true)
  expect(transcript.inert).toBe(false)
})

async function mountSide() {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const [Stage] = web.slots!['conversation.overlay'] as Component[]
  const container = renderSolid(() => <Stage />)
  await settle()
  harness.server!.of(main)!.send('doc', {
    kind: 'sidechat.index',
    value: { sides: [{ id: 82, at: 40, openedAt: 1 }] },
  })
  uiState.set('ext.side-chat.front', 82)
  flush()
  await settle()
  harness.server!.of(82)!.send('view', {
    conversation: { id: 82 },
    entries: [],
    docs: { sidechat: { of: main, at: 40, effects: false } },
  } as unknown as StreamedView)
  harness.server!.of(82)!.send('doc', {
    kind: 'sidechat',
    value: { of: main, at: 40, effects: false },
  })
  flush()
  return container
}

it('keeps an unsent draft or quotes it verbatim before ending, clearing only what was sent', async () => {
  const container = await mountSide()
  fillComposer(82, '  Also check\nthe login *flow*\n')
  const summarize = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Summarize side chat #82"]')!.click()
  summarize()
  flush()
  expect(container.querySelector('[data-draft-guard]')).not.toBeNull()
  expect(harness.endings).toEqual([])
  await expectDistinctAgentNames(agent)
  expect(await agent.act({ steps: [{ ref: 'Keep editing', action: 'press' }] })).toMatchObject({
    ok: true,
  })
  flush()
  expect(container.querySelector('[data-draft-guard]')).toBeNull()
  expect(composerDraft(82)?.text).toBe('  Also check\nthe login *flow*\n')
  summarize()
  flush()
  expect(await agent.act({ steps: [{ ref: 'Include draft', action: 'press' }] })).toMatchObject({
    ok: true,
  })
  await settle()
  expect(harness.endings).toEqual([
    {
      action: 'inject',
      args: { id: 82, draft: '  Also check\nthe login *flow*\n' },
      keepalive: false,
    },
  ])
  expect(composerDraft(82)).toBeUndefined()
})

it('can summarize without an unsent draft, leaving it in the composer', async () => {
  const container = await mountSide()
  fillComposer(82, 'leave this out')
  container.querySelector<HTMLButtonElement>('[aria-label="Summarize side chat #82"]')!.click()
  flush()
  expect(await agent.act({ steps: [{ ref: 'Without it', action: 'press' }] })).toMatchObject({
    ok: true,
  })
  await settle()
  expect(harness.endings).toEqual([{ action: 'inject', args: { id: 82 }, keepalive: false }])
  expect(composerDraft(82)?.text).toBe('leave this out')
})

it('asks before discarding a draft and can keep editing', async () => {
  const container = await mountSide()
  fillComposer(82, 'not sent')
  container.querySelector<HTMLButtonElement>('[aria-label="Discard side chat #82"]')!.click()
  flush()
  expect(container.textContent).toContain('Unsent draft')
  expect(container.textContent).not.toContain('Include draft')
  expect(await agent.act({ steps: [{ ref: 'Keep editing', action: 'press' }] })).toMatchObject({
    ok: true,
  })
  flush()
  expect(harness.endings).toEqual([])
  expect(composerDraft(82)?.text).toBe('not sent')
})

it('opens an item follow-up with its context and returns to the existing side chat', async () => {
  const container = renderSolid(() => (
    <AskAboutItem
      key="shell:a"
      at={1}
      conversation={parseConversationId(69)}
      tag="shell"
      title="Review output"
      text="Full output"
      pane={null}
    />
  ))
  await settle()
  expect(container.querySelector('textarea')?.placeholder).toBe('Ask #69 about this…')
  await expectDistinctAgentNames(agent)
  expect(
    await agent.act({
      steps: [
        {
          ref: 'Ask about Inbox item shell:a',
          action: 'setValue',
          args: ['  Why this output?\n'],
        },
        { ref: 'Ask in a side chat about shell:a', action: 'press' },
      ],
    }),
  ).toMatchObject({ ok: true })
  expect(harness.opened).toEqual([
    {
      args: {
        item: {
          key: 'shell:a',
          conversation: 69,
          title: 'Review output',
          text: 'Full output',
        },
        text: '  Why this output?\n',
      },
      source: 'agent',
    },
  ])
  expect(uiState.snapshot()['ext.side-chat.front']).toBe(82)
  harness.server!.of(1)!.send('doc', {
    kind: 'sidechat.items',
    value: { sides: [{ id: 82, of: 69, item: 'shell:a' }] },
  })
  flush()
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.querySelector('[data-item-side-chat="82"]')).not.toBeNull()
})

it('switches to side chat mode on Tab or the switch, opens a side chat on send, then returns to normal', async () => {
  const container = await mount()
  const editor = container.querySelector<HTMLTextAreaElement>('#composer-input')!
  const frame = () => container.querySelector('[data-side-mode]')!.getAttribute('data-side-mode')
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  flush()
  expect(frame()).toBe('side')
  expect(editor.placeholder).toBe('Ask on the side — @ultimate keeps running…')
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  flush()
  expect(frame()).toBe('normal')

  await expectDistinctAgentNames(agent)
  const label = 'Composer sends to @ultimate · Tab switches'
  expect(agent.snapshot().find((entry) => entry.label === label)?.pressed).toBe(false)
  const switched = await agent.act({
    steps: [{ ref: label, action: 'setPressed', args: [true] }],
  })
  expect(switched).toMatchObject({ ok: true })
  flush()
  expect(frame()).toBe('side')
  const send = [...container.querySelectorAll('button')].find((b) => b.textContent === 'send')!
  send.click()
  await settle()
  flush()
  expect(harness.opened).toEqual([{ args: { text: 'a side question' }, source: 'person' }])
  expect(frame()).toBe('normal')
  expect(uiState.snapshot()['ext.side-chat.front']).toBe(82)
})
