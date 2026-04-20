import { ThumbnailGeneratorPort } from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'
import sharp from 'sharp'

const thumbnailMaxPixels = 512

export const SharpThumbnailGeneratorPortLive = Layer.succeed(ThumbnailGeneratorPort, {
  generateImageThumbnail: (input) =>
    Effect.tryPromise({
      try: async () => {
        const body = await sharp(input.body, {
          animated: false,
          limitInputPixels: 80_000_000
        })
          .rotate()
          .resize({
            width: thumbnailMaxPixels,
            height: thumbnailMaxPixels,
            fit: 'inside',
            withoutEnlargement: true
          })
          .webp({ quality: 82 })
          .toBuffer()

        return {
          body: new Uint8Array(body),
          mimeType: 'image/webp'
        }
      },
      catch: (cause) => cause
    })
})
