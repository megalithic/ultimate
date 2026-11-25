import { FileTextIcon } from '@lucide/solid'
import { defineWebExtension, isMac } from '@/sdk/solid'
import { ReaderCard } from './card.solid.tsx'
import { PathImage } from './image.solid.tsx'
import { PathCode, PathLink, ReaderLink } from './link.solid.tsx'
import { Picker, pickerDialog } from './picker.solid.tsx'
import ReaderSurface from './surface.solid.tsx'
import { commentCommands } from './shortcuts.ts'

export default defineWebExtension({
  surfaces: [
    {
      id: 'reader',
      title: 'Read',
      icon: FileTextIcon,
      description: 'Read a markdown file beside the conversation and comment on it',
      order: 65,
      component: ReaderSurface,
    },
  ],
  commands: [
    ...commentCommands(isMac),
    {
      id: 'reader.open',
      title: 'Read markdown file…',
      run: (context) => context.open(pickerDialog),
    },
  ],
  slots: { overlay: [ReaderLink, Picker] },
  entries: { 'review.comments': ReaderCard },
  inlineCode: PathCode,
  link: PathLink,
  image: PathImage,
})
