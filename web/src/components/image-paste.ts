import { imageMimeTypes } from '../../../shared/protocol.ts'
import { fitImage } from './image-resize.ts'

export const imageFiles = (files: readonly File[]) =>
  files.filter((file) => imageMimeTypes.includes(file.type))

export function pastedFiles(event: ClipboardEvent, accepts: (file: { type: string }) => boolean) {
  return Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && accepts(item))
    .flatMap((item) => {
      const file = item.getAsFile()
      return file ? [file] : []
    })
}

export const droppedFiles = (event: DragEvent, accepts: (file: { type: string }) => boolean) =>
  Array.from(event.dataTransfer?.files ?? []).filter(accepts)

export function imageDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read pasted image')),
    )
    reader.addEventListener('error', () => reject(new Error('Could not read pasted image')))
    reader.readAsDataURL(blob)
  })
}

export async function readImage(file: File) {
  const { blob, note } = await fitImage(file)
  return {
    blob,
    image: {
      data: (await imageDataUrl(blob)).split(',')[1],
      mimeType: blob.type,
      ...(note && { note }),
    },
  }
}
