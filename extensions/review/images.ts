import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { maxImageBytes } from '../../shared/protocol.ts'

export async function reviewImage(home: string, path: string) {
  if (!isAbsolute(path)) throw new Error('Image path must be absolute')
  const root = await realpath(join(home, 'attachments'))
  const resolved = await realpath(path)
  const rest = relative(root, resolved)
  if (!rest || rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest))
    throw new Error('Image must be inside attachments')
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxImageBytes)
      throw new Error('Image is too large or not a file')
    const bytes = Buffer.alloc(maxImageBytes + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > maxImageBytes) throw new Error('Image is too large')
    const data = bytes.subarray(0, bytesRead)
    const mimeType = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : data[0] === 255 && data[1] === 216 && data[2] === 255
        ? 'image/jpeg'
        : ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())
          ? 'image/gif'
          : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : undefined
    if (!mimeType) throw new Error('Unsupported image type')
    return { type: 'image' as const, data: data.toString('base64'), mimeType }
  } finally {
    await handle.close()
  }
}
