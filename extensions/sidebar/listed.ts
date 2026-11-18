import type { ConversationId } from '@earendil-works/pi-durable'
export const topLevelRows = <T extends { id: number; parentConversationId?: ConversationId }>(
  conversations: readonly T[],
  unlisted: ReadonlySet<number>,
) =>
  conversations.filter(
    (conversation) =>
      conversation.parentConversationId === undefined && !unlisted.has(conversation.id),
  )

export const subagentParents = (
  conversations: readonly { parentConversationId?: number; ownerTaskId?: unknown }[],
) => [
  ...new Set(
    conversations.flatMap((conversation) =>
      conversation.ownerTaskId === undefined || conversation.parentConversationId === undefined
        ? []
        : [conversation.parentConversationId],
    ),
  ),
]

export const allSubagents = (parents: readonly number[], open: boolean) => ({
  expanded: open ? [...parents] : [],
  folded: open ? [] : [...parents],
})
