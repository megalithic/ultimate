import { expect, it, vi } from 'vitest'
import type { UltimateContext } from '../../../../web/src/sdk/types.ts'
import { commentCommands, registerCommentSelection } from '../../shortcuts.ts'

it('offers the comment command only in Reader with an available selection', async ({
  onTestFinished,
}) => {
  let pick = false
  const run = vi.fn<() => void>()
  const unregister = registerCommentSelection({ available: () => pick, run })
  onTestFinished(unregister)
  const context = { surface: 'reader' } as UltimateContext
  const command = commentCommands(true).find((item) => item.keys === 'c')!
  expect(command.when!(context)).toBe(false)
  pick = true
  expect(command.when!(context)).toBe(true)
  expect(command.when!({ ...context, surface: 'agent' })).toBe(false)
  await command.run(context)
  expect(run).toHaveBeenCalledOnce()
  unregister()
  expect(command.when!(context)).toBe(false)
  expect(commentCommands(true).map((item) => item.keys)).toEqual(['c', 'ctrl+a'])
  expect(commentCommands(false).map((item) => item.keys)).toEqual(['c'])
})
