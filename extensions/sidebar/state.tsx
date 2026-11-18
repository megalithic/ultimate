import type { ConversationId } from '@earendil-works/pi-durable'
import { getState, useUltimate, useUiState } from '@/sdk'
import type { JsonValue } from '@/sdk'
import { uiState } from '@/sdk/client'
import { allSubagents, subagentParents } from './listed.ts'

const key = (persistedConversationsKey: string) => `ext.conversations.${persistedConversationsKey}`

export const useSidebarState = <T extends JsonValue>(
  persistedConversationsKey: string,
  initial: T,
) => useUiState<T>(key(persistedConversationsKey), initial)

export function setAllSubagents(open: boolean) {
  const { expanded, folded } = allSubagents(subagentParents(getState().conversations), open)
  uiState.set(key('expanded'), expanded)
  uiState.set(key('folded'), folded)
}

export function useShell() {
  const actions = useUltimate()
  return {
    ...actions,
    switchConversation: (id: ConversationId, options?: { replace?: boolean }) => {
      actions.showSurface('agent')
      actions.switchConversation(id, options)
    },
  }
}
