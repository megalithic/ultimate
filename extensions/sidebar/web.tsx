import { defineWebExtension } from '@/sdk'
import { Conversations, Seen } from './sidebar.tsx'
import { setAllSubagents } from './state.tsx'
import { UltimateButton, UltimateWordmark } from './ultimate.tsx'

export default defineWebExtension({
  slots: {
    sidebar: Conversations,
    'titlebar.brand': [UltimateWordmark],
    'titlebar.left': [{ component: UltimateButton, order: 100 }],
    overlay: [Seen],
  },
  commands: [
    {
      id: 'sidebar.subagents.collapse',
      title: 'Collapse all sub-agents',
      group: 'Conversations',
      run: () => setAllSubagents(false),
    },
    {
      id: 'sidebar.subagents.expand',
      title: 'Expand all sub-agents',
      group: 'Conversations',
      run: () => setAllSubagents(true),
    },
  ],
})
