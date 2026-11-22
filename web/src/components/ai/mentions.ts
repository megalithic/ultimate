import { parseConversationId, parseEntryId } from '../../../../lib/ids.ts'
export const mentionPattern = /(?<![\w/#&])#(\d{3,})(?:\/(\d+))?(?![\w/])/g
const quantity =
  ' ?(?:%|percent|times|more|of|ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|px|mm|cm|m|inch(?:es)?|ft|feet)\\b'
const name = '[\\w-](?:[\\w.-]*[\\w-])?'
const globalMessageIdMention = new RegExp(
  `(?<![\\w/#&-])(?:[Mm]essage|[Cc]ard) (\\d+)(?:@([A-Za-z_.](?:[\\w.-]*[\\w-])?)(?::(${name}))?)?(?![\\w/@]|[.:]\\w|${quantity})`,
  'g',
)
const anyMention = new RegExp(`${mentionPattern.source}|${globalMessageIdMention.source}`, 'g')

export const mentionHref = (conversation: string, entry?: string) =>
  `#conversation-${conversation}${entry ? `-${entry}` : ''}`
export const messageHref = (message: string, project?: string, machine?: string) =>
  `#message-${message}${project ? `@${project}${machine ? `:${machine}` : ''}` : ''}`

export function parseMention(href: string) {
  const match = /^#conversation-(\d+)(?:-(\d+))?$/.exec(href)
  return match
    ? {
        conversation: parseConversationId(Number(match[1])),
        entry: match[2] ? parseEntryId(Number(match[2])) : undefined,
      }
    : undefined
}

export function parseMessageMention(href: string) {
  const match = /^#message-(\d+)$/.exec(href)
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) ? id : undefined
}

export function parseRemoteMessageMention(href: string) {
  const match = new RegExp(`^#message-(\\d+)@([^:@]+)(?::(${name}))?$`).exec(href)
  const message = match ? Number(match[1]) : NaN
  return match && Number.isSafeInteger(message)
    ? { message, project: match[2], ...(match[3] ? { machine: match[3] } : {}) }
    : undefined
}

type Mention = { text: string; href: string } & (
  | { conversation: string; entry?: string }
  | { message: string; project?: string; machine?: string }
)

export function splitMentions(text: string) {
  const parts: (string | Mention)[] = []
  let last = 0
  for (const match of text.matchAll(anyMention)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      match[3] === undefined
        ? {
            conversation: match[1],
            entry: match[2],
            text: match[0],
            href: mentionHref(match[1], match[2]),
          }
        : {
            message: match[3],
            ...(match[4] ? { project: match[4] } : {}),
            ...(match[5] ? { machine: match[5] } : {}),
            text: match[0],
            href: messageHref(match[3], match[4], match[5]),
          },
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

type Node = { type: string; value?: string; children?: Node[]; url?: string }

export function remarkMentions() {
  const visit = (node: Node) => {
    const preservesExistingLink = () => node.type === 'link' || node.type === 'linkReference'
    if (!node.children || preservesExistingLink()) return
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || !child.value || !/#|message |card /i.test(child.value)) {
        visit(child)
        return [child]
      }
      return splitMentions(child.value).map((part) =>
        typeof part === 'string'
          ? { type: 'text', value: part }
          : { type: 'link', url: part.href, children: [{ type: 'text', value: part.text }] },
      )
    })
  }
  return visit
}
