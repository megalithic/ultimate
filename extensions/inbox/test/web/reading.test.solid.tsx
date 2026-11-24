import type { ConversationId } from '@earendil-works/pi-durable'
import { expect, it, vi } from 'vitest'
import { Show } from 'solid-js'
import { ItemFollowUp } from '../../points.ts'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'

vi.mock('@/sdk/solid', async (original) => ({
  ...(await original<typeof import('@/sdk/solid')>()),
  Provided: (props: { point: unknown; input: { key: string } }) => (
    <Show when={props.point === ItemFollowUp}>
      <span data-follow-up-for={props.input.key}>Follow up</span>
    </Show>
  ),
}))
vi.mock('../../../conversations/ui.solid.tsx', () => ({
  ConversationRef: () => null,
}))
vi.mock('../../../questions/ui.solid.tsx', () => ({
  MessageQuestions: () => null,
}))

import { Reading } from '../../reading.solid.tsx'

it('sets a provided item’s follow-up apart below its pane only when it has a conversation', () => {
  const item = {
    key: 'shell:a',
    at: 1,
    tag: 'shell',
    title: 'Output',
    pane: <p>Item content</p>,
  }
  const container = renderSolid(() => (
    <>
      <Reading
        entry={{
          key: item.key,
          at: 1,
          item: { ...item, conversation: 69 as ConversationId },
        }}
        now={1000}
        onBack={() => {}}
        phone={false}
      />
      <Reading
        entry={{
          key: 'shell:b',
          at: 1,
          item: { ...item, key: 'shell:b', pane: <p>Other item</p> },
        }}
        now={1000}
        onBack={() => {}}
        phone={false}
      />
    </>
  ))
  expect(container.querySelectorAll('[data-item-follow-up]')).toHaveLength(1)
  const followUp = container.querySelector('[data-item-follow-up]')!
  expect(followUp.querySelector('[data-follow-up-for="shell:a"]')).not.toBeNull()
  expect(followUp.previousElementSibling?.textContent).toBe('Item content')
  expect(followUp.className).toContain('border-t')
})

it('renders the bold lead link in the heading without title images', () => {
  const container = renderSolid(() => (
    <Reading
      entry={{
        key: 'message:1',
        at: 1,
        message: {
          id: 1,
          at: 1,
          from: 69 as ConversationId,
          to: 'user',
          text: '**Remove the throttle: [PR 1784](https://example.com/pr/1784) ![image](https://example.com/image.png)**\n\nBody',
          reply: true,
          state: 'delivered',
        },
      }}
      now={1000}
      onBack={() => {}}
      phone={false}
    />
  ))
  const heading = container.querySelector('h2')!
  expect(heading.textContent?.trim()).toBe('Remove the throttle: PR 1784')
  expect(heading.querySelectorAll('p')).toHaveLength(1)
  expect(heading.querySelector('img')).toBeNull()
  const link = heading.querySelector('[data-href], a[href]')!
  expect(link.textContent).toBe('PR 1784')
  expect(link.getAttribute('data-href') ?? link.getAttribute('href')).toBe(
    'https://example.com/pr/1784',
  )
})
