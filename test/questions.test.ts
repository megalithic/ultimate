import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { apis, eventHost, temp, until } from './helpers.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import type { FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux'
import { configure, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'
import { context, prepareHarness } from '../server/harness.ts'
import type { OpenHost } from '../server/harness.ts'
import type { ExtensionHost } from '../server/extensions.ts'
import type { ActionContext } from '../server/actions.ts'
import messagesExtension, {
  actions as messageActions,
  gist,
} from '../extensions/messages/server.ts'
import { Started } from '../extensions/messages/addresses.ts'
import { Messages } from '../extensions/messages/api.ts'
import type { Question } from '../extensions/messages/api.ts'
import { checkQuestions } from '../extensions/messages/questions.ts'
import { answersNamedAtLineStart } from '../lib/question-answers.ts'
import questionsExtension, {
  actions,
  answerText,
  userActions,
} from '../extensions/questions/server.ts'
import { Standing } from '../extensions/subagents/api.ts'
import type { SubagentsService } from '../extensions/subagents/api.ts'
import {
  landingPending,
  pendingLandingCards,
  Workspaces,
} from '../extensions/workspaces/workspaces.ts'

const hosts: OpenHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
})

const decisions: Question[] = [
  {
    text: 'Scope',
    kind: 'choice',
    ref: '1',
    options: [
      { label: 'all of it', key: 'a', recommended: true },
      { label: 'the format only', key: 'b' },
    ],
  },
  {
    text: 'Suites',
    kind: 'multi',
    ref: '2',
    options: [
      { label: 'unit', key: 'a', recommended: true },
      { label: 'e2e', key: 'b' },
      { label: 'lint', key: 'c', recommended: true },
    ],
  },
  { text: 'Land it?', kind: 'confirm', ref: '3' },
  { text: 'How finished is it?', kind: 'scale', ref: '4', scale: { min: 1, max: 5 } },
  { text: 'Name', kind: 'text', ref: '5' },
]

async function fixture() {
  const home = await temp('ultimate-messages-questions-')
  const prepared = await prepareHarness({
    home,
    ultimateRoot: home,
    userHome: home,
    faux: fauxProvider(),
  })
  let opened: OpenHost
  const services = new Map<string, unknown>()
  const openers: (() => Promise<void>)[] = []
  const closers: (() => Promise<void>)[] = []
  const events = eventHost(() => opened.harness, 'questions')
  openers.push(async () => void (await events.start()))
  closers.push(async () => void (await events.stop()))
  const host = {
    ...prepared,
    userHome: home,
    projectSettings: async () => ({}),
    harness: () => opened.harness,
    ...apis(services),
    doc: () => undefined,
    onOpen: (fn: () => Promise<void>) => openers.push(fn),
    onClose: (fn: () => Promise<void>) => closers.push(fn),
    emit: events.emit,
    react: events.react,
    notice: (message: string) => {
      throw new Error(message)
    },
  } as unknown as ExtensionHost
  // Messages’ core dependencies: no standing agents to list, no worktrees, no concluded conversations.
  services.set('subagents', { residents: async () => [] } satisfies Partial<SubagentsService>)
  services.set('workspaces', { doc: Workspaces, landingPending, pendingLandingCards })
  services.set('conversations', { concludedIn: async () => new Set() })
  prepared.registry.install(messagesExtension(host))
  prepared.registry.install(questionsExtension(host))
  const observed: string[] = []
  /** Runs with each input the agent reads, as an agent's tool calls would during its turn. */
  let heard: ((text: string) => Promise<unknown>) | undefined
  const route: FauxResponseFactory = async (transcript) => {
    prepared.faux!.appendResponses([route])
    const last = transcript.messages.at(-1)!
    const text = typeof last.content === 'string' ? last.content : ''
    observed.push(text)
    await heard?.(text)
    if (last.role === 'user' && text.startsWith('SEND '))
      return fauxAssistantMessage([fauxToolCall('message', JSON.parse(text.slice(5)))], {
        stopReason: 'toolUse',
      })
    return fauxAssistantMessage([fauxText('Sent.')])
  }
  prepared.faux!.setResponses([route])
  opened = await prepared.open()
  hosts.push(opened)
  for (const fn of openers) await fn()
  const log = async () => (await opened.harness.snapshot(Messages, ROOT_CONVERSATION_ID, context))!
  // Settled: every event reacted to and every task done, deliveries included.
  const settled = () =>
    until(
      async () =>
        (await events.settled()) &&
        (await opened.harness.commit(
          async (tx) =>
            (await tx.scanTasks({}, 1000)).items.every((task) => task.state.status === 'terminal'),
          context,
        )),
    )
  const entries = async (id: ConversationId) =>
    (
      await opened.harness.commit((tx) => tx.scanEntries({ conversationId: id }, 1000), context)
    ).items.toSorted((a, b) => a.id - b.id)
  /** A new conversation registered as the standing @ultimate. */
  const ultimate = async () => {
    const conversation = await opened.harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      context,
    )
    const agent = await opened.root.agent(context)
    await opened.harness.commit(async (tx) => {
      await configure(tx, conversation.id, { model: agent.model, tools: agent.tools })
      ;(await tx.doc(Standing, ROOT_CONVERSATION_ID)).ultimate = conversation.id
    }, context)
    return conversation.id
  }
  const type = async (id: ConversationId, content: string) => {
    const conversation = (await opened.harness.conversation(id, context))!
    return (await conversation.submit({ type: 'input', content }, context)).wait(context)
  }
  /** @ultimate's `message` call with `args`; the message it sent, or the tool's error. */
  const ask = async (id: ConversationId, args: Record<string, unknown>) => {
    await type(id, `SEND ${JSON.stringify({ to: 'user', ...args })}`)
    await settled()
    const call = (await entries(id)).findLast((entry) => entry.kind === 'pi.tool-result')
    const result = call?.model?.[0] as unknown as
      | { isError?: boolean; content: { text?: string }[] }
      | undefined
    return {
      error: result?.isError ? result.content.map((part) => part.text).join('') : undefined,
      message: (await log()).messages.findLast((m) => m.from === id && m.to === 'user'),
    }
  }
  const action = (conversationId?: number) =>
    ({ host, conversationId, signal: new AbortController().signal }) as ActionContext
  const answer = (args: Parameters<typeof actions.answer>[0]) => actions.answer(args, action())
  const dismiss = (messageId: number) => actions.dismiss({ messageId }, action())
  const settle = (by: number, args: { messageId: number; text: string; dismiss?: boolean }) =>
    messageActions.settle(args, action(by))
  /** A branch that @ultimate `by` started. */
  const branch = async (by: ConversationId) => {
    const conversation = await opened.harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      context,
    )
    const agent = await opened.root.agent(context)
    await opened.harness.commit(async (tx) => {
      await configure(tx, conversation.id, { model: agent.model, tools: agent.tools })
      ;(await tx.doc(Started, conversation.id)).by = by
    }, context)
    return conversation.id
  }
  return {
    opened,
    hear: (fn: typeof heard) => (heard = fn),
    ultimate,
    branch,
    type,
    ask,
    answer,
    dismiss,
    settle,
    log,
    entries,
    observed,
    settled,
  }
}

describe('questions on a message', () => {
  it('are stored as the tool validated them, only on reply-expected messages to the user', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const sent = await f.ask(id, { text: 'Decide these.', questions: decisions })
    expect(sent.error).toBeUndefined()
    expect(sent.message).toMatchObject({ state: 'delivered', questions: decisions })
    const oneWay = await f.ask(id, { text: 'FYI', reply: false, questions: decisions })
    expect(oneWay.error).toContain('reply-expected message to the user')
    expect(oneWay.message?.text).toBe('Decide these.')
    // To a conversation, never: questions are the user's card.
    const other = await f.opened.harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      context,
    )
    const toConversation = await f.ask(id, { to: `#${other.id}`, text: 'Hi', questions: decisions })
    expect(toConversation.error).toContain('reply-expected message to the user')
    expect((await f.log()).messages.filter((m) => m.questions)).toHaveLength(1)
  })

  it('refuses questions the card could not answer, naming the question', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const refused = async (questions: unknown, reason: string) => {
      const { error } = await f.ask(id, { text: 'Decide.', questions })
      expect(error).toContain(reason)
    }
    await refused([], 'at least one question')
    await refused(
      [{ text: 'One?', kind: 'choice', options: [{ label: 'only' }] }],
      'question 1 needs at least two options',
    )
    await refused(
      [{ text: 'One?', kind: 'choice', ref: '3', options: [{ label: 'a' }, { label: ' a ' }] }],
      'question 3 repeats an option label',
    )
    await refused(
      [
        {
          text: 'One?',
          kind: 'choice',
          options: [
            { label: 'x', key: 'a' },
            { label: 'y', key: 'a' },
          ],
        },
      ],
      'repeats an option key',
    )
    await refused(
      [{ text: 'One?', kind: 'choice', options: [{ label: 'x' }, { label: 'Something else' }] }],
      'offers "Something else…" itself',
    )
    await refused([{ text: '  ', kind: 'confirm' }], 'question 1 has no text')
    await refused(
      [{ text: 'One?', kind: 'choice', options: [{ label: 'x' }, { label: ' ' }] }],
      'has an option without a label',
    )
    await refused([{ text: 'Rate', kind: 'scale' }], 'needs scale')
    await refused([{ text: 'Rate', kind: 'scale', scale: { min: 1, max: 20 } }], 'at most 10 steps')
    await refused(
      [
        { text: 'Same', kind: 'confirm', ref: '1' },
        { text: 'Same', kind: 'confirm', ref: '2' },
      ],
      "repeats another question's text",
    )
    await refused(
      [
        { text: 'A', kind: 'confirm', ref: '1' },
        { text: 'B', kind: 'confirm', ref: '1' },
      ],
      "repeats another question's ref",
    )
    // A schema miss is the tool's own error.
    await refused([{ text: 'One?', kind: 'ranking' }], 'kind')
    expect((await f.log()).messages.filter((m) => m.to === 'user')).toHaveLength(0)
  })

  it('answers in the message numbering for every kind, with a note after the answers', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, { text: 'Decide these.', questions: decisions })
    expect(userActions).toEqual(['answer', 'dismiss'])
    await expect(
      f.answer({ messageId: message!.id, answers: [{ question: 'Unknown', answer: 'Yes' }] }),
    ).rejects.toThrow('Unknown question')
    await expect(
      f.answer({
        messageId: message!.id,
        answers: [
          { question: 'Scope', answer: 'all of it' },
          { question: 'Scope', answer: 'the format only' },
        ],
      }),
    ).rejects.toThrow('Unknown question')
    await expect(f.answer({ messageId: message!.id, answers: [] })).rejects.toThrow(
      'Invalid answers',
    )
    const results = await Promise.allSettled([
      f.answer({
        messageId: message!.id,
        answers: [
          { question: 'Scope', answer: 'the format only' },
          { question: 'Suites', answer: ['unit', 'lint'] },
          { question: 'Land it?', answer: 'Yes' },
          { question: 'How finished is it?', answer: '4' },
          { question: 'Name', answer: 'Questions' },
        ],
        note: 'Also rename the tab.',
      }),
      f.answer({ messageId: message!.id, answers: [{ question: 'Scope', answer: 'all of it' }] }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await f.settled()
    const reply = (await f.log()).messages.find((m) => m.re === message!.id)!
    expect(reply.text).toBe(
      '1b. Scope: the format only\n\n2a,c. Suites: unit, lint\n\n3: Yes\n\n4: 4\n\n5: Questions\n\nNote: Also rename the tab.',
    )
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('answered')
    expect(f.observed.some((text) => text.includes('2a,c. Suites: unit, lint'))).toBe(true)
    await expect(
      f.answer({ messageId: message!.id, answers: [{ question: 'Scope', answer: 'all of it' }] }),
    ).rejects.toThrow('These questions are no longer open')
  })

  it('sends a note on its own, leaving every question open, and free text for a message without questions', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, { text: 'Decide these.', questions: decisions })
    await expect(f.answer({ messageId: message!.id, answers: [], note: '  ' })).rejects.toThrow(
      'Invalid answers',
    )
    // The bug: a note asking something back closed every question it never answered.
    await f.answer({ messageId: message!.id, answers: [], note: 'Before I answer: why 5?' })
    await f.settled()
    const log = (await f.log()).messages
    expect(log.find((m) => m.re === message!.id)).toMatchObject({
      text: 'Before I answer: why 5?',
      open: ['1', '2', '3', '4', '5'],
    })
    expect(log.find((m) => m.id === message!.id)).toMatchObject({ state: 'delivered' })
    expect(log.find((m) => m.id === message!.id)?.answered).toBeUndefined()
    expect(
      f.observed.some((text) =>
        text.includes(
          `Answer to message ${message!.id}; questions 1, 2, 3, 4, 5 are still open on the card, unanswered:\nBefore I answer: why 5?`,
        ),
      ),
    ).toBe(true)
    await f.answer({ messageId: message!.id, text: 'Free text naming no question' })
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('delivered')
    await f.ask(id, { text: 'What should the tab be called?' })
    const plain = (await f.log()).messages.find((m) => m.text === 'What should the tab be called?')!
    expect(plain.questions).toBeUndefined()
    await expect(f.answer({ messageId: plain.id, text: '  ' })).rejects.toThrow('Invalid answers')
    await expect(f.answer({ messageId: plain.id, text: 'x', note: 'y' })).rejects.toThrow(
      'Invalid answers',
    )
    const { id: reply } = await f.answer({ messageId: plain.id, text: ' Questions ' })
    expect((await f.log()).messages.find((m) => m.id === reply)).toMatchObject({
      from: 'user',
      re: plain.id,
      text: 'Questions',
    })
    await expect(f.answer({ messageId: plain.id, text: 'Again' })).rejects.toThrow(
      'These questions are no longer open',
    )
  })

  it("keeps @ultimate's open message open until its card answers it, naming it by its questions", async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, { text: 'Decide these.', questions: decisions })
    await f.type(
      f.opened.root.id,
      `SEND ${JSON.stringify({ to: `#${id}`, text: 'Unrelated update' })}`,
    )
    await f.settled()
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('delivered')
    await f.type(id, 'Something else entirely')
    const typed = await f.entries(id)
    const note = typed.findLast((entry) => entry.kind === 'board.open')!
    expect(note.data).toEqual({ ids: [message!.id] })
    expect(note.model?.[0]?.content).toMatch(
      new RegExp(
        `^Open questions to the user.*\\n- message ${message!.id}: questions 1\\. Scope; 2\\. Suites; 3\\. Land it\\?; 4\\. How finished is it\\?; 5\\. Name \\(asked just now\\)\\n`,
        's',
      ),
    )
    expect(typed[typed.indexOf(note) + 1]).toMatchObject({ kind: 'pi.user' })
    await f.answer({
      messageId: message!.id,
      answers: [{ question: 'Land it?', answer: 'No' }],
      note: 'And 5: Cards',
    })
    await f.settled()
    expect((await f.log()).messages.find((m) => m.id === message!.id)).toMatchObject({
      state: 'delivered',
      answered: { 2: 'No' },
    })
    await expect(
      f.answer({ messageId: message!.id, answers: [{ question: 'Land it?', answer: 'Yes' }] }),
    ).rejects.toThrow('Question 3 is already answered')
    await expect(f.answer({ messageId: message!.id, text: '3: Yes' })).rejects.toThrow(
      'Question 3 is already answered',
    )
    // A notification's Approve was written before anything was answered: it answers only what is still open.
    await expect(
      f.answer({
        messageId: message!.id,
        answers: [{ question: 'Land it?', answer: 'Yes' }],
        onlyOpen: true,
      }),
    ).rejects.toThrow('These questions are already answered')
    await f.type(id, 'Still deciding')
    expect(
      (await f.entries(id)).findLast((entry) => entry.kind === 'board.open')?.model?.[0]?.content,
    ).toContain(
      `- message ${message!.id}: questions 1. Scope; 2. Suites; 4. How finished is it?; 5. Name (asked`,
    )
    await f.answer({
      messageId: message!.id,
      text: '1b\n2a,c. Suites\n4: 3\n\n5: Cards',
    })
    await f.settled()
    expect((await f.log()).messages.find((m) => m.id === message!.id)).toMatchObject({
      state: 'answered',
      answered: { 0: 'the format only', 1: ['unit', 'lint'], 2: 'No', 3: '3', 4: 'Cards' },
    })
    expect((await f.log()).messages.findLast((m) => m.re === message!.id)?.open).toBeUndefined()
    const count = (await f.entries(id)).filter((entry) => entry.kind === 'board.open').length
    await f.type(id, 'Thanks')
    expect((await f.entries(id)).filter((entry) => entry.kind === 'board.open')).toHaveLength(count)
  })

  it("names an open question by its text when its position is another question's number", async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, {
      text: 'Decide.',
      questions: [
        { text: 'Size', kind: 'text', ref: '2' },
        { text: 'Colour', kind: 'text' },
      ],
    })
    await f.answer({ messageId: message!.id, text: '2: Small' })
    const log = (await f.log()).messages
    expect(log.find((m) => m.re === message!.id)?.open).toEqual(['"Colour"'])
    expect(gist(log.find((m) => m.id === message!.id)!)).toBe('questions Colour')
    await f.answer({ messageId: message!.id, text: 'Colour: red' })
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('answered')
  })

  it("answers exactly the card's questions, whatever their answers or the note say", async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, {
      text: 'Decide.',
      questions: [
        { text: 'Scope', kind: 'text' },
        { text: 'Scope: deployment', kind: 'text' },
      ],
    })
    await f.answer({
      messageId: message!.id,
      answers: [{ question: 'Scope', answer: 'deployment: Production' }],
      note: '2: not yet',
    })
    const log = (await f.log()).messages
    expect(log.find((m) => m.id === message!.id)).toMatchObject({
      state: 'delivered',
      answered: { 0: 'deployment: Production' },
    })
    expect(log.find((m) => m.re === message!.id)?.open).toEqual(['2'])
  })

  it('dismisses a partly answered message whole', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const { message } = await f.ask(id, { text: 'Decide these.', questions: decisions })
    await f.answer({ messageId: message!.id, answers: [{ question: 'Name', answer: 'Cards' }] })
    const { id: approved } = await f.answer({
      messageId: message!.id,
      answers: [
        { question: 'Land it?', answer: 'Yes' },
        { question: 'Name', answer: 'Questions' },
      ],
      onlyOpen: true,
    })
    expect((await f.log()).messages.find((m) => m.id === approved)?.text).toBe('3: Yes')
    await f.dismiss(message!.id)
    await f.settled()
    expect((await f.log()).messages.find((m) => m.id === message!.id)).toMatchObject({
      state: 'dismissed',
      answered: { 2: 'Yes', 4: 'Cards' },
    })
  })

  it('dismisses one open question with a one-way note that starts no run, leaving the others open', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const first = (await f.ask(id, { text: 'Keep it running?', questions: [decisions[2]] }))
      .message!
    const second = (await f.ask(id, { text: 'Which layout?' })).message!
    const before = (await f.entries(id)).filter((entry) => entry.kind === 'pi.assistant').length
    const { id: note } = await f.dismiss(first.id)
    await f.settled()
    const log = (await f.log()).messages
    expect(log.find((m) => m.id === first.id)?.state).toBe('dismissed')
    expect(log.find((m) => m.id === second.id)?.state).toBe('delivered')
    expect(log.find((m) => m.id === note)).toMatchObject({
      from: 'user',
      to: id,
      re: first.id,
      reply: false,
      state: 'delivered',
      text: expect.stringContaining('(message ' + first.id + '): questions 3. Land it?'),
    })
    const after = await f.entries(id)
    expect(after.findLast((entry) => entry.kind === 'board.message')?.data).toMatchObject({
      id: note,
      delivery: 'note',
    })
    expect(after.filter((entry) => entry.kind === 'pi.assistant')).toHaveLength(before)
    await expect(f.dismiss(first.id)).rejects.toThrow('These questions are no longer open')
    await expect(f.answer({ messageId: first.id, text: 'Yes' })).rejects.toThrow(
      'These questions are no longer open',
    )
  })
})

describe('settling for the user', () => {
  it("lets @ultimate answer a branch's question from its chat, as the user's answer that names its source", async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const asker = await f.branch(id)
    const { message } = await f.ask(asker, { text: 'Ship it?', questions: [decisions[2]] })
    await expect(f.settle(asker, { messageId: message!.id, text: 'Yes' })).rejects.toThrow(
      "Only @ultimate settles the user's questions",
    )
    // Its turn starts with the branch's question by id, and the action that settles it.
    f.hear(async (text) =>
      text === 'approved, ship it'
        ? f.settle(id, { messageId: message!.id, text: '3: Yes, ship it' })
        : undefined,
    )
    await f.type(id, 'approved, ship it')
    await f.settled()
    const said = (await f.entries(id)).find((e) => e.kind === 'pi.user')!
    const note = (await f.entries(id)).find((e) => e.kind === 'board.open')!
    expect(note.model?.[0]?.content).toContain(
      `- message ${message!.id} from #${asker}: questions 3. Land it?`,
    )
    expect(note.model?.[0]?.content).toContain(
      "tools.action({extension: 'messages', action: 'settle'",
    )
    const log = (await f.log()).messages
    expect(log.find((m) => m.id === message!.id)?.state).toBe('answered')
    expect(log.find((m) => m.re === message!.id)).toMatchObject({
      from: 'user',
      to: asker,
      text: '3: Yes, ship it',
      via: { conversation: id, entry: said.id },
    })
    expect(log).toContainEqual(expect.objectContaining({ from: asker, to: id, report: true }))
    // The branch reads it as the user's answer, settled by @ultimate.
    expect(
      f.observed.some(
        (text) =>
          text.includes('settled for them by @ultimate') && text.includes('3: Yes, ship it'),
      ),
    ).toBe(true)
    await expect(f.settle(id, { messageId: message!.id, text: 'No' })).rejects.toThrow(
      'These questions are no longer open',
    )
  })

  it('settles only the questions its text names, and the whole message when it names none', async () => {
    const f = await fixture()
    const id = await f.ultimate()
    const asker = await f.branch(id)
    const { message } = await f.ask(asker, {
      text: 'Decide.',
      questions: decisions.slice(0, 3),
    })
    await f.settle(id, { messageId: message!.id, text: '3: Yes' })
    await f.settled()
    expect((await f.log()).messages.find((m) => m.id === message!.id)).toMatchObject({
      state: 'delivered',
      answered: { 2: 'Yes' },
    })
    expect(
      (await f.entries(id)).some(
        (entry) =>
          entry.kind === 'board.answered' &&
          JSON.stringify(entry.model).includes('questions 1, 2 are still open on the card'),
      ),
    ).toBe(true)
    // A misnamed option names a question too: refused, never the whole message.
    await expect(f.settle(id, { messageId: message!.id, text: '1z' })).rejects.toThrow(
      'Question 1 has no option z',
    )
    // A repeated answer names a question, so it never settles the whole message.
    await expect(f.settle(id, { messageId: message!.id, text: '3: Yes' })).rejects.toThrow(
      'Question 3 is already answered',
    )
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('delivered')
    await f.settle(id, { messageId: message!.id, text: 'Go with what you recommended.' })
    expect((await f.log()).messages.find((m) => m.id === message!.id)?.state).toBe('answered')
  })
})

describe('answer text', () => {
  it('names options by letter, several by letters, typed and rated answers by number, and unnumbered ones by text', () => {
    expect(
      answerText(
        [
          { question: 'Scope', answer: 'all of it' },
          { question: 'Suites', answer: 'e2e' },
          { question: 'Name', answer: 'only the keyboard one' },
        ],
        decisions,
      ),
    ).toBe('1a. Scope: all of it\n\n2b. Suites: e2e\n\n5: only the keyboard one')
    // A multi answer is a list, so a label may hold a comma; regression for life#25770's refused "Finance, coarse only".
    expect(
      answerText(
        [{ question: 'Suites', answer: ['unit, fast', 'lint'] }],
        [
          {
            ...decisions[1],
            options: [
              { label: 'unit, fast', key: 'a' },
              { label: 'unit', key: 'b' },
              { label: 'lint', key: 'c' },
            ],
          },
        ],
      ),
    ).toBe('2a,c. Suites: unit, fast, lint')
    // A typed "Something else…" names no option: the number alone.
    expect(answerText([{ question: 'Scope', answer: 'neither' }], decisions)).toBe('1: neither')
    expect(
      answerText(
        [{ question: 'Land it?', answer: 'Yes' }],
        [{ text: 'Land it?', kind: 'confirm' }],
      ),
    ).toBe('Land it?: Yes')
    expect(answerText([], decisions, 'Just a thought.')).toBe('Just a thought.')
  })

  it('names back the questions a reply answers, as answerText writes them or as typed at a line start', () => {
    const unnumbered: Question[] = [
      { text: 'Land it?', kind: 'confirm' },
      { text: 'Which **layout**?\nSee the preview.', kind: 'text' },
    ]
    const written = answerText(
      [
        { question: 'Land it?', answer: 'No' },
        { question: 'Which **layout**?\nSee the preview.', answer: 'Grid' },
      ],
      unnumbered,
      'Note: 1. also the docs',
    )
    expect(answersNamedAtLineStart(written, unnumbered)).toEqual({ 0: 'No', 1: 'Grid' })
    expect(
      answersNamedAtLineStart(
        '1: neither\n2a,c. Suites: unit, lint\n3 more things: later\n4\n5. Cards',
        decisions,
      ),
    ).toEqual({ 0: 'neither', 1: ['unit', 'lint'], 4: 'Cards' })
    expect(answersNamedAtLineStart('Before I answer: why 5?', decisions)).toEqual({})
    // A number names one question: an explicit ref wins over an unnumbered question's position.
    const mixed: Question[] = [
      { text: 'Size', kind: 'text', ref: '2' },
      { text: 'Colour', kind: 'text' },
    ]
    expect(answersNamedAtLineStart('2: Small', mixed)).toEqual({ 0: 'Small' })
    expect(answersNamedAtLineStart('Colour: red\n1: big', mixed)).toEqual({ 1: 'red' })
    // Keyless options go by the letters voice reads out; a confirmation by y/n.
    const keyless: Question[] = [
      { text: 'Pick', kind: 'choice', ref: '1', options: [{ label: 'x' }, { label: 'y' }] },
      { text: 'Ship?', kind: 'confirm', ref: '2' },
    ]
    expect(answersNamedAtLineStart('1b\n2y', keyless)).toEqual({ 0: 'y', 1: 'Yes' })
    expect(() => answersNamedAtLineStart('1z', keyless)).toThrow('Question 1 has no option z')
    // Explicit keys keep their letter; keyless options take the letters left over.
    const mixedKeys: Question[] = [
      {
        text: 'Where?',
        kind: 'choice',
        ref: '1',
        options: [{ label: 'Inbox' }, { label: 'Transcript', key: 'a' }],
      },
    ]
    for (const label of ['Inbox', 'Transcript'])
      expect(
        answersNamedAtLineStart(
          answerText([{ question: 'Where?', answer: label }], mixedKeys),
          mixedKeys,
        ),
      ).toEqual({ 0: label })
    expect(answersNamedAtLineStart('1b', mixedKeys)).toEqual({ 0: 'Inbox' })
    // One heading names one question: the longest text it starts with.
    const overlapping: Question[] = [
      { text: 'Scope', kind: 'text' },
      { text: 'Scope: deployment', kind: 'text' },
    ]
    expect(
      answersNamedAtLineStart(
        answerText([{ question: 'Scope: deployment', answer: 'Production' }], overlapping),
        overlapping,
      ),
    ).toEqual({ 1: 'Production' })
    expect(
      answersNamedAtLineStart(
        answerText(
          [
            { question: 'Scope', answer: 'All' },
            { question: 'Scope: deployment', answer: 'Production' },
          ],
          overlapping,
        ),
        overlapping,
      ),
    ).toEqual({ 0: 'All', 1: 'Production' })
    // A multiline heading is one span: its lines name no other question.
    const spanning: Question[] = [
      { text: 'Scope', kind: 'text' },
      { text: 'Scope: deployment\nTarget', kind: 'text' },
    ]
    expect(answersNamedAtLineStart('Scope: deployment\nTarget: prod', spanning)).toEqual({
      1: 'prod',
    })
  })

  it('drops fields that do not apply to a kind and trims what it keeps', () => {
    expect(
      checkQuestions([
        {
          text: ' Land it? ',
          kind: 'confirm',
          options: [{ label: 'x' }, { label: 'y' }],
          placeholder: 'no',
        },
        {
          text: 'Rate',
          kind: 'scale',
          scale: { min: 1, max: 3, low: ' low ', high: '' },
          placeholder: 'no',
        },
        { text: 'Name', kind: 'text', placeholder: ' e.g. Questions ' },
        {
          text: 'Pick',
          kind: 'choice',
          options: [
            { label: ' a ', detail: ' why ', recommended: false, preview: ' ' },
            { label: 'b', key: 'b', recommended: true },
          ],
        },
      ]),
    ).toEqual([
      { text: 'Land it?', kind: 'confirm' },
      { text: 'Rate', kind: 'scale', scale: { min: 1, max: 3, low: 'low' } },
      { text: 'Name', kind: 'text', placeholder: 'e.g. Questions' },
      {
        text: 'Pick',
        kind: 'choice',
        options: [
          { label: 'a', detail: 'why' },
          { label: 'b', key: 'b', recommended: true },
        ],
      },
    ])
    // Only a whole "Other" / "Something else" is the card's own option; a label that starts so is a real one.
    expect(
      checkQuestions([
        {
          text: 'Scope',
          kind: 'choice',
          options: [{ label: 'This repo' }, { label: 'Other repos too' }],
        },
      ])[0].options!.map((o) => o.label),
    ).toEqual(['This repo', 'Other repos too'])
  })

  it('names a message by its questions in the open-questions note, else by its asking line', () => {
    expect(gist({ text: 'Decide.', questions: decisions })).toBe(
      'questions 1. Scope; 2. Suites; 3. Land it?; 4. How finished is it?; 5. Name',
    )
    expect(gist({ text: 'Done.\n\nShould I submit it?' })).toBe('Should I submit it?')
  })
})
