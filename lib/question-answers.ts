type Question = {
  text: string
  kind?: string
  ref?: string
  options?: { label: string; key?: string }[]
}
export type Answer = { question: string; answer: string | string[] }
export type Reply = { answers?: Answer[]; note?: string; text?: string }

const filled = (text: unknown) => typeof text === 'string' && !!text.trim()

export function validAnswers(value: unknown): value is Answer[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a: { question?: unknown; answer?: unknown } | null) =>
        a &&
        typeof a.question === 'string' &&
        (Array.isArray(a.answer)
          ? a.answer.length > 0 && a.answer.every(filled)
          : filled(a.answer)),
    )
  )
}

export function checkAnswers(answers: { question: string }[], questions: readonly Question[]) {
  if (
    new Set(answers.map((a) => a.question)).size !== answers.length ||
    answers.some((a) => !questions.some((q) => q.text === a.question))
  )
    throw new Error('Unknown question')
}

function keysOf(question: Question, labels: string[]) {
  const keys = (question.options ?? []).flatMap((o) =>
    o.key && labels.includes(o.label) ? [o.key] : [],
  )
  return keys.length === labels.length ? keys.join(',') : ''
}

export function answerText(answers: Answer[], questions: readonly Question[], note?: string) {
  const lines = answers.map(({ question, answer: given }) => {
    const q = questions.find((candidate) => candidate.text === question)!
    const labels = [given].flat()
    const keys = keysOf(q, labels)
    const answer = labels.join(', ')
    if (!q.ref) return `${q.text}: ${answer}`
    return keys ? `${q.ref}${keys}. ${q.text}: ${answer}` : `${q.ref}: ${answer}`
  })
  if (note?.trim()) lines.push(answers.length ? `Note: ${note.trim()}` : note.trim())
  return lines.join('\n\n')
}

export type AnswersByQuestionIndex = Record<number, string | string[]>

const position = (question: Question, index: number) => question.ref ?? String(index + 1)

function givenOnLine(question: Question, index: number, line: string) {
  const numbered = new RegExp(
    `^${position(question, index)}([a-z](?:,[a-z])*)?(?:[.:]\\s*(.*))?$`,
  ).exec(line)
  if (numbered) {
    const keys = numbered[1]?.split(',') ?? []
    const labels = keys.flatMap(
      (key) => (question.options ?? []).find((option) => option.key === key)?.label ?? [],
    )
    if (keys.length && labels.length === keys.length)
      return question.kind === 'multi' ? labels : labels.join(', ')
    const words = numbered[2]?.trim() ?? ''
    const titled = `${question.text.split('\n')[0]}:`
    return (words.startsWith(titled) ? words.slice(titled.length).trim() : words) || undefined
  }
  const prefix = `${question.text}:`
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() || undefined : undefined
}

function byMultilineText(question: Question, text: string) {
  if (!question.text.includes('\n')) return undefined
  const prefix = `${question.text}:`
  const at = `\n${text}`.indexOf(`\n${prefix}`)
  if (at < 0) return undefined
  return (
    text
      .slice(at + prefix.length)
      .split('\n')[0]
      .trim() || undefined
  )
}

export function answersNamedAtLineStart(
  text: string,
  questions: readonly Question[],
  alreadyAnswered: AnswersByQuestionIndex = {},
) {
  const given: AnswersByQuestionIndex = {}
  const lines = text.split('\n').map((line) => line.trim())
  for (const [index, question] of questions.entries()) {
    if (index in alreadyAnswered) continue
    const found =
      lines.reduce<string | string[] | undefined>(
        (first, line) => first ?? givenOnLine(question, index, line),
        undefined,
      ) ?? byMultilineText(question, text)
    if (found !== undefined) given[index] = found
  }
  return given
}

export function checkReply(input: { answers?: unknown; note?: unknown; text?: unknown }) {
  const optionalString = (value: unknown) => {
    if (value !== undefined && typeof value !== 'string') throw new Error('Invalid answers')
    return value?.trim()
  }
  const text = optionalString(input.text)
  const note = optionalString(input.note)
  const answers = input.answers ?? []
  const invalid =
    text === undefined
      ? !validAnswers(answers) || (!answers.length && !note)
      : !text || input.answers !== undefined || !!note
  if (invalid) throw new Error('Invalid answers')
}

export function replyText(input: Reply, questions: readonly Question[]) {
  const text = input.text?.trim()
  const note = input.note?.trim()
  const answers = input.answers ?? []
  if (text !== undefined) return text
  checkAnswers(answers, questions)
  return answerText(answers, questions, note)
}
