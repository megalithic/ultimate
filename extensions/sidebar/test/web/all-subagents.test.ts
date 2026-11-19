import { expect, it } from 'vitest'
import { allSubagents, anySubagentsOpen, subagentParents } from '../../listed.ts'

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

it('counts an in-flight group open unless folded, and only shown tree groups outside flights by expanded', () => {
  const children = new Map([
    [1, [{ id: 2 }]],
    [2, [{ id: 4 }]],
    [7, [{ id: 8 }]],
    [9, [{ id: 10 }]],
    [10, [{ id: 11 }]],
    [82, [{ id: 83 }]],
  ])
  const treeTops = [7]
  expect(anySubagentsOpen(children, [1], treeTops, [1, 2, 7, 9], [])).toBe(true)
  expect(anySubagentsOpen(children, [1], treeTops, [1, 2, 9, 10, 82], [1])).toBe(false)
  expect(anySubagentsOpen(children, [1], treeTops, [1, 2, 7, 9], [1])).toBe(true)
  expect(anySubagentsOpen(children, [1], treeTops, [], [])).toBe(true)
})

it('expands every group, or folds every in-flight group and closes every tree group', () => {
  expect(allSubagents([1, 2], true)).toEqual({ expanded: [1, 2], folded: [] })
  expect(allSubagents([1, 2], false)).toEqual({ expanded: [], folded: [1, 2] })
})
