// Adapted from vercel/ai-elements packages/elements/src/message.tsx (Apache-2.0, see LICENSE).
// Changes: `from` is a plain role, no branches or actions; only the code plugin; denser typography; links go through
// the extensions' `link` renderers, inline code through their `inlineCode` renderers; long code blocks fold.
import { cn } from 'cn'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { isValidElement, memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
  defaultComponents,
  defaultRemarkPlugins,
  Streamdown,
} from 'streamdown'
import type { CustomRendererProps, ExtraProps } from 'streamdown'
import { ExtensionBoundary } from '../../app/boundary.tsx'
import { useExtensions } from '../../sdk/hooks.ts'
import {
  codeBlockLanguages,
  codeBlockRenderers,
  inlineCodeRenderers,
  linkRenderers,
} from '../../sdk/registry.ts'
import { codePlugin } from './code-block.tsx'
import { mentionHref, parseMention, remarkMentions, splitMentions } from './mentions.ts'

export type MessageProps = HTMLAttributes<HTMLDivElement> & { from: 'user' | 'assistant' }

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full flex-col gap-2',
      from === 'user' ? 'is-user' : 'is-assistant',
      className,
    )}
    data-from={from}
    {...props}
  />
)

export const MessageContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex min-w-0 max-w-full flex-col gap-2 text-[14px] leading-relaxed',
      'group-[.is-user]:rounded-lg group-[.is-user]:border group-[.is-user]:border-border/70 group-[.is-user]:bg-secondary/60 group-[.is-user]:px-3.5 group-[.is-user]:py-2.5',
      className,
    )}
    {...props}
  />
)

const CoreLink = defaultComponents.a
/** A link as the `link` renderers compose it, starting with Streamdown's, which asks before opening a new tab. */
function Link(props: ComponentProps<'a'> & ExtraProps) {
  const renderers = linkRenderers(useExtensions())
  const { href, children } = props
  // A `#id` mention stays its text unless a renderer knows the conversation.
  const core = href && parseMention(href) ? <>{children}</> : <CoreLink {...props} />
  // Streamdown marks a link whose Markdown is still streaming.
  if (!href || href === 'streamdown:incomplete-link') return core
  return renderers.reduce<ReactNode>(
    (inner, { extension, version, component: Renderer }) => (
      <ExtensionBoundary
        extension={extension}
        fallback={inner}
        key={extension}
        variant="inline"
        version={version}
      >
        <Renderer core={inner} href={href}>
          {children}
        </Renderer>
      </ExtensionBoundary>
    ),
    core,
  )
}

/**
 * Plain text with its `#id` mentions rendered as Markdown mentions are (conversation chips), for text shown verbatim
 * rather than as Markdown: prompts, abstracts, divergences.
 */
export function MentionText({ text }: { text: string }) {
  return splitMentions(text).map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      <Link href={mentionHref(part.conversation, part.entry)} key={index}>
        {part.text}
      </Link>
    ),
  )
}

const CoreCode = defaultComponents.code
/** An inline code span as the `inlineCode` renderers compose it, starting with Streamdown's. */
function InlineCode(props: ComponentProps<'code'> & ExtraProps) {
  const renderers = inlineCodeRenderers(useExtensions())
  const { children } = props
  const core = <CoreCode {...props} />
  if (typeof children !== 'string') return core
  return renderers.reduce<ReactNode>(
    (inner, { extension, version, component: Renderer }) => (
      <ExtensionBoundary
        extension={extension}
        fallback={inner}
        key={extension}
        variant="inline"
        version={version}
      >
        <Renderer code={children} core={inner} />
      </ExtensionBoundary>
    ),
    core,
  )
}

/** The text of a fenced block as Streamdown hands it over: a string, or a `code` element holding one. */
function blockText(children: ReactNode) {
  if (typeof children === 'string') return children
  if (
    isValidElement<{ children?: unknown }>(children) &&
    typeof children.props.children === 'string'
  )
    return children.props.children
  return ''
}

const CoreBlock = defaultComponents.code
/** A fenced code block: folded unless an extension renders its language, which then owns the block whole. */
function FencedCode(props: ComponentProps<'code'> & ExtraProps) {
  const languages = codeBlockLanguages(useExtensions())
  const language = /language-(\S+)/.exec(props.className ?? '')?.[1]
  if (language !== undefined && languages.includes(language))
    return CoreBlock ? <CoreBlock {...props} /> : null
  return <FoldedCode {...props} />
}

/**
 * A fenced code block that overflows Streamdown's height limit fades out over a toggle that shows all of it, and folds
 * back. A block within the limit shows as it is.
 */
function FoldedCode(props: ComponentProps<'code'> & ExtraProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)
  const lines = blockText(props.children).replace(/\n$/, '').split('\n').length
  useEffect(() => {
    const block = ref.current
    if (!block || open) return undefined
    // The body is swapped once highlighted, and laid out only on screen (`content-visibility: auto`): measure on
    // every resize of the block.
    const measure = () => {
      const body = block.querySelector('[data-streamdown="code-block-body"]')
      setOverflows(!!body && body.scrollHeight > body.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(block)
    return () => observer.disconnect()
  }, [open, lines])
  if (!overflows) return <div ref={ref}>{CoreBlock && <CoreBlock {...props} />}</div>
  const toggle = () => {
    setOpen(!open)
    // Folding a long block back leaves its top above the window: bring it back into view.
    if (open) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }))
  }
  return (
    <div
      className={cn(
        'relative',
        open &&
          '[&_[data-streamdown=code-block-body]]:max-h-none! [&_[data-streamdown=code-block-body]]:pb-10!',
      )}
      ref={ref}
    >
      {CoreBlock && <CoreBlock {...props} />}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-px bottom-px flex justify-center rounded-b-md pb-2',
          !open && 'h-20 items-end bg-linear-to-t from-terminal via-terminal/85 to-transparent',
        )}
      >
        <button
          aria-expanded={open}
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/80 bg-background/90 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={toggle}
          type="button"
        >
          {open ? (
            <>
              <ChevronUpIcon className="size-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3" />
              Expand · {lines} lines
            </>
          )}
        </button>
      </div>
    </div>
  )
}

const components = { a: Link, inlineCode: InlineCode, code: FencedCode }
// After GFM, so autolinked URLs are links already and keep their `#fragment`.
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkMentions]

/** A fenced code block as the `codeBlocks` renderers of its language compose it, starting with the core block. */
function ExtensionCodeBlock({ code, language, isIncomplete }: CustomRendererProps) {
  const renderers = codeBlockRenderers(useExtensions(), language)
  const core = (
    <CodeBlock code={code} isIncomplete={isIncomplete} language={language} lineNumbers={false}>
      <CodeBlockCopyButton />
    </CodeBlock>
  )
  return renderers.reduce<ReactNode>(
    (inner, { extension, version, component: Renderer }) => (
      <ExtensionBoundary extension={extension} fallback={inner} key={extension} version={version}>
        <Renderer code={code} core={inner} incomplete={isIncomplete} language={language} />
      </ExtensionBoundary>
    ),
    core,
  )
}
const controls = { code: { copy: true, download: false }, table: false, mermaid: false } as const

/** Markdown that may still be streaming. */
export const MessageResponse = memo(
  ({ className, ...props }: ComponentProps<typeof Streamdown>) => {
    const languages = codeBlockLanguages(useExtensions()).join(' ')
    const plugins = useMemo(
      () => ({
        code: codePlugin,
        renderers: languages
          ? [{ language: languages.split(' '), component: ExtensionCodeBlock }]
          : [],
      }),
      [languages],
    )
    return (
      <Streamdown
        className={cn('markdown min-w-0', className)}
        components={components}
        controls={controls}
        lineNumbers={false}
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        shikiTheme={codePlugin.getThemes()}
        {...props}
      />
    )
  },
  (previous, next) =>
    previous.children === next.children && previous.isAnimating === next.isAnimating,
)
MessageResponse.displayName = 'MessageResponse'
