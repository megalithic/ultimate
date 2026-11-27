import { imageDataUrl, readImage } from '@/components/image-paste.ts'

export async function prepareImage(file: File) {
  const { blob, image } = await readImage(file)
  const bitmap = await createImageBitmap(blob)
  try {
    let scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height))
    for (;;) {
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
      )
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const preview = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: 0.65,
      })
      if (preview.size <= 14 * 1024) return { image, thumb: await imageDataUrl(preview) }
      scale *= 0.75
    }
  } finally {
    bitmap.close()
  }
}
