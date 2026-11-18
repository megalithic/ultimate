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

export const anySubagentsOpen = (
  childrenByParent: ReadonlyMap<number, readonly { id: number }[]>,
  flights: readonly number[],
  expanded: readonly number[],
  folded: readonly number[],
) => {
  const flightTrees = new Set<number>()
  const visit = (id: number) => {
    flightTrees.add(id)
    for (const child of childrenByParent.get(id) ?? []) visit(child.id)
  }
  flights.forEach(visit)
  return (
    flights.some((id) => childrenByParent.has(id) && !folded.includes(id)) ||
    expanded.some((id) => childrenByParent.has(id) && !flightTrees.has(id))
  )
}

export const allSubagents = (parents: readonly number[], open: boolean) => ({
  expanded: open ? [...parents] : [],
  folded: open ? [] : [...parents],
})
