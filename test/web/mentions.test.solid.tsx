import { expect, it, vi } from 'vitest'
import { MentionLink } from '../../extensions/conversations/mention.solid.tsx'
import {
  mentionHref,
  parseMention,
  parseMessageMention,
  parseRemoteMessageMention,
  remarkMentions,
  splitMentions,
} from '../../web/src/components/ai/mentions.ts'
import { parse } from '../../web/src/components/markdown/parse.ts'
import type { ElementContent } from '../../web/src/components/markdown/parse.ts'
import { renderSolid } from './solid-dom-setup.ts'

const { openEntry, switchConversation, showSurface } = vi.hoisted(() => ({
  openEntry: vi.fn<(event: string, data: unknown) => void>(),
  switchConversation: vi.fn<(id: number) => void>(),
  showSurface: vi.fn<(surface: string) => void>(),
}))
vi.mock('@/sdk/solid', () => ({
  ROOT: 1,
  cn: (...names: unknown[]) => names.filter(Boolean).join(' '),
  events: { emit: openEntry },
  useDocOf: () => () => ({ conversations: { 157029: { feature: 'Sidebar' } } }),
  useConversations: () => () => [{ id: 157029, title: 'Sidebar polish landed' }],
  switchConversation,
  showSurface,
}))

const mentions = (text: string) =>
  splitMentions(text).flatMap((part) => (typeof part === 'string' ? [] : [part.text]))

it('finds conversation mentions and breadcrumbs in running text', () => {
  expect(mentions('I reopened #157029, then #157833/158003 (and #30726).')).toEqual([
    '#157029',
    '#157833/158003',
    '#30726',
  ])
})

it('leaves short numbers, words, paths, URLs and entities alone', () => {
  expect(
    mentions(
      '#1 priority, issue #12, a#157029, x/#157029, https://h.dev/p#157029, &#160;, #157029x, ##157029, #157/a',
    ),
  ).toEqual([])
})

it('round-trips a mention through its href', () => {
  expect(parseMention(mentionHref('157029'))).toEqual({ conversation: 157029, entry: undefined })
  expect(parseMention(mentionHref('157029', '158003'))).toEqual({
    conversation: 157029,
    entry: 158003,
  })
  expect(parseMention('https://example.com/?conversation=1')).toBeUndefined()
})

type Node = { type: string; value?: string; url?: string; children?: Node[] }
const text = (value: string): Node => ({ type: 'text', value })

it('turns text mentions into links but never inside code or existing links', () => {
  const tree: Node = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [text('see #157029 and '), { type: 'inlineCode', value: '#157833' }],
      },
      { type: 'code', value: 'echo #157833' },
      { type: 'link', url: 'https://x.dev', children: [text('#157833')] },
    ],
  }
  remarkMentions()(tree)
  expect(tree.children?.[0]?.children).toEqual([
    text('see '),
    { type: 'link', url: '#conversation-157029', children: [text('#157029')] },
    text(' and '),
    { type: 'inlineCode', value: '#157833' },
  ])
  expect(tree.children?.[1]).toEqual({ type: 'code', value: 'echo #157833' })
  expect(tree.children?.[2]?.children).toEqual([text('#157833')])
})

it('renders a known mention as its chip and an unknown one as its text', () => {
  const known = renderSolid(() => (
    <MentionLink core="core" href={mentionHref('157029', '158003')}>
      #157029/158003
    </MentionLink>
  ))
  const chip = known.querySelector<HTMLAnchorElement>('a[data-conversation-mention="157029"]')!
  expect(chip.querySelector('[data-feature="Sidebar"]')).not.toBeNull()
  expect(chip.textContent).toContain('/158003')
  expect(chip.title).toBe('Open #157029 at entry 158003: Sidebar polish landed')
  chip.click()
  expect(openEntry).toHaveBeenCalledExactlyOnceWith('messages:open', {
    conversation: 157029,
    entry: 158003,
  })
  expect(showSurface).toHaveBeenCalledExactlyOnceWith('agent')
  expect(switchConversation).toHaveBeenCalledExactlyOnceWith(157029)

  const unknown = renderSolid(() => (
    <MentionLink core="#999999" href={mentionHref('999999')}>
      #999999
    </MentionLink>
  ))
  expect(unknown.textContent).toBe('#999999')
  expect(unknown.querySelector('a')).toBeNull()
})

it('links message and card ids in prose, which name a card by its global id alone', () => {
  const parts = splitMentions('Answered message 706 and Card 12; see #157029/706.').filter(
    (part) => typeof part !== 'string',
  )
  expect(parts.map((part) => [part.text, part.href])).toEqual([
    ['message 706', '#message-706'],
    ['Card 12', '#message-12'],
    ['#157029/706', '#conversation-157029-706'],
  ])
  expect(parseMessageMention('#message-706')).toBe(706)
  expect(parseMessageMention(mentionHref('706'))).toBeUndefined()
  expect(mentions('a message, message-706, messages 7, card 1.5, postcard 3, message 7x')).toEqual(
    [],
  )
  expect(
    mentions(
      'the message 5 seconds ago; insert the card 2 inches in; card 3 of 5; message 2 more times',
    ),
  ).toEqual([])
  expect(mentions('see message 706 for details, then card 12 is done')).toEqual([
    'message 706',
    'card 12',
  ])
})

it('links a message on another project, optionally on a named machine', () => {
  const parts = splitMentions(
    "sent to my-app (message 501@my-app), the laptop's message 7@.config:laptop.",
  ).filter((part) => typeof part !== 'string')
  expect(parts.map((part) => [part.text, part.href])).toEqual([
    ['message 501@my-app', '#message-501@my-app'],
    ['message 7@.config:laptop', '#message-7@.config:laptop'],
  ])
  expect(parseRemoteMessageMention('#message-501@my-app')).toEqual({
    message: 501,
    project: 'my-app',
  })
  expect(parseRemoteMessageMention('#message-7@.config:laptop')).toEqual({
    message: 7,
    project: '.config',
    machine: 'laptop',
  })
  expect(parseMessageMention('#message-501@my-app')).toBeUndefined()
  expect(parseRemoteMessageMention('#message-501')).toBeUndefined()
  expect(
    mentions(
      'message 5@3pm, message 5@ noon, card 2@x@y, card 2@x.y@z, message 5@app:host/notes, message 5@a:b:c',
    ),
  ).toEqual([])
  expect(mentions('see message 706: done. Then message 8@app.')).toEqual([
    'message 706',
    'message 8@app',
  ])
})

it('links a mention on a dotted project, which GFM would autolink as an email', () => {
  const links = (nodes: ElementContent[]): string[] =>
    nodes.flatMap((node) =>
      node.type !== 'element'
        ? []
        : node.tagName === 'a'
          ? [String(node.properties.href)]
          : links(node.children),
    )
  const hrefs = (markdown: string) => links(parse(markdown).nodes)
  expect(hrefs('message 567@.config')).toEqual(['#message-567@.config'])
  expect(hrefs('message 7@.config:laptop')).toEqual(['#message-7@.config:laptop'])
  expect(hrefs('message 501@my-app')).toEqual(['#message-501@my-app'])
  expect(hrefs('card 3@other_app')).toEqual(['#message-3@other_app'])
  expect(hrefs('Then see message 5@.config.')).toEqual(['#message-5@.config'])
  expect(hrefs('mail user@example.com or 567@.config')).toEqual([
    'mailto:user@example.com',
    'mailto:567@.config',
  ])
  expect(hrefs('message [567@example.com](mailto:567@example.com)')).toEqual([
    'mailto:567@example.com',
  ])
  expect(hrefs('message 5@x.y@z.com')).toEqual(['mailto:5@x.y'])
})
