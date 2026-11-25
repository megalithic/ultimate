import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { errnoCode, ignoring, isMissing, meansNone } from '../../lib/errors.ts'
import { git } from '../../lib/git.ts'

export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const MAX_PATH = 1024
export const MARKDOWN = /\.(md|markdown)$/i

export const markdownPaths = (nulSeparated: string) => [
  ...new Set(nulSeparated.split('\0').filter((path) => MARKDOWN.test(path))),
]

export type Resolved = {
  path: string
  absolute: string
  root: string
  size: number
  mtime: number
}

export type Workspace = { state?: string; path?: string }

const inside = (root: string, target: string) => {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

const real = (path: string) => realpath(path).catch(ignoring(isMissing))

const tooLarge = (path: string, maxBytes: number) =>
  new Error(`${path} is larger than ${maxBytes / 1024 / 1024} MB`)
const changed = (path: string) => new Error(`${path} changed while it was read: open it again`)

export async function gitCommonDir(cwd: string) {
  const dir = await git(
    { cwd, timeout: 10_000 },
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ).catch(meansNone)
  return dir === undefined ? undefined : real(dir)
}

export async function checkoutRoots(
  projectRoot: string,
  workspace: Workspace | undefined,
  commonDir: (cwd: string) => Promise<string | undefined>,
): Promise<string[]> {
  if (workspace?.state !== 'ready' || !workspace.path) return [projectRoot]
  const [mine, project] = await Promise.all([commonDir(workspace.path), commonDir(projectRoot)])
  return mine && mine === project ? [...new Set([workspace.path, projectRoot])] : [projectRoot]
}

const markdownPolicy = {
  extensions: MARKDOWN,
  maxBytes: MAX_BYTES,
  kind: 'markdown',
}
const imagePolicy = {
  extensions: IMAGE,
  maxBytes: MAX_IMAGE_BYTES,
  kind: 'image',
}
type Policy = typeof markdownPolicy

export const resolveMarkdown = (input: unknown, roots: readonly string[]) =>
  resolveFile(input, roots, markdownPolicy)

async function resolveFile(
  input: unknown,
  roots: readonly string[],
  policy: Policy,
): Promise<Resolved> {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`Name a ${policy.kind} file`)
  const path = input.trim()
  if (path.length > MAX_PATH || path.includes('\0')) throw new Error('That is not a file path')
  if (path.startsWith('~')) throw new Error('Home paths are not allowed: use a path in the project')
  if (!policy.extensions.test(path)) throw new Error(`Only ${policy.kind} files can be read here`)

  const realRoots = [
    ...new Set((await Promise.all(roots.map(real))).filter((root) => root !== undefined)),
  ]
  if (!realRoots.length) throw new Error('No project folder to read from')
  const candidates = isAbsolute(path) ? [path] : roots.map((root) => resolve(root, path))

  let outside = false
  for (const candidate of candidates) {
    const target = await real(candidate)
    if (!target) continue
    const root = realRoots.find((each) => inside(each, target))
    if (!root) {
      outside = true
      continue
    }
    if (!policy.extensions.test(target))
      throw new Error(`Only ${policy.kind} files can be read here`)
    const info = await stat(target)
    if (!info.isFile()) throw new Error(`${path} is not a file`)
    if (info.size > policy.maxBytes) throw tooLarge(path, policy.maxBytes)
    return {
      path: relative(root, target),
      absolute: target,
      root,
      size: info.size,
      mtime: info.mtimeMs,
    }
  }
  throw new Error(outside ? `${path} is outside the project` : `No such file: ${path}`)
}

export async function readResolved(file: Resolved) {
  const { buffer, ...read } = await readBuffer(file, markdownPolicy)
  return { ...read, text: buffer.toString('utf8') }
}

export async function readImage(input: unknown, roots: readonly string[]) {
  const file = await resolveFile(input, roots, imagePolicy)
  const { buffer } = await readBuffer(file, imagePolicy)
  return {
    data: buffer.toString('base64'),
    mimeType: IMAGE_TYPES[extname(file.absolute).toLowerCase()],
  }
}

async function readBuffer(file: Resolved, policy: Policy) {
  const handle = await open(file.absolute, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: unknown) => {
      throw errnoCode(error) === 'ELOOP' ? changed(file.path) : error
    },
  )
  try {
    const opened = await handle.stat()
    const now = await real(file.absolute)
    const there = now === undefined ? undefined : await stat(now).catch(ignoring(isMissing))
    if (
      !opened.isFile() ||
      !now ||
      !inside(file.root, now) ||
      !policy.extensions.test(now) ||
      there?.dev !== opened.dev ||
      there.ino !== opened.ino
    )
      throw changed(file.path)
    const buffer = Buffer.alloc(policy.maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > policy.maxBytes) throw tooLarge(file.path, policy.maxBytes)
    return {
      ...file,
      size: length,
      mtime: opened.mtimeMs,
      buffer: buffer.subarray(0, length),
    }
  } finally {
    await handle.close()
  }
}
