import { defineWebExtension } from '@/sdk/solid'
import { OpeningBar, Rail } from './rail.solid.tsx'
import { TitlebarProject } from './switcher.solid.tsx'

export default defineWebExtension({
  slots: { 'shell.rail': Rail, overlay: OpeningBar, 'titlebar.project': TitlebarProject },
})
