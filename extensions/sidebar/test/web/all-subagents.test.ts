import { expect, it } from 'vitest'
import { allSubagents, subagentParents } from '../../listed.ts'

const conversations = [
  { id: 1 },
  { id: 2, parentConversationId: 1, ownerTaskId: 7 },
  { id: 3, parentConversationId: 1, ownerTaskId: 8 },
  { id: 4, parentConversationId: 2, ownerTaskId: 9 },
  { id: 5, parentConversationId: 1 },
]

it('names each conversation with owned children once', () => {
  expect(subagentParents(conversations)).toEqual([1, 2])
})

it('expands every group, or folds every in-flight group and closes every tree group', () => {
  expect(allSubagents([1, 2], true)).toEqual({ expanded: [1, 2], folded: [] })
  expect(allSubagents([1, 2], false)).toEqual({ expanded: [], folded: [1, 2] })
})
