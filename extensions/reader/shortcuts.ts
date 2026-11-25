import type { CommandContribution } from '../../web/src/sdk/types.ts'

type CommentSelection = { available: () => boolean; run: () => void }
let selection: CommentSelection | undefined

export function registerCommentSelection(next: CommentSelection) {
  selection = next
  return () => {
    if (selection === next) selection = undefined
  }
}

export function commentCommands(mac: boolean): CommandContribution[] {
  const when: CommandContribution['when'] = (context) => {
    const focused = document.activeElement
    const typing =
      focused instanceof HTMLElement &&
      (focused.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName))
    return context.surface === 'reader' && !typing && !!selection?.available()
  }
  const run = () => {
    if (selection?.available()) selection.run()
  }
  return [
    { id: 'reader.comment', title: 'Comment on the selection', keys: 'c', when, run },
    ...(mac
      ? [
          {
            id: 'reader.comment.control',
            title: 'Comment on the selection',
            keys: 'ctrl+a',
            when,
            run,
          },
        ]
      : []),
  ]
}
