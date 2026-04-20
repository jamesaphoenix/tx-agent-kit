/**
 * Test helper for seeding media assets via the real two-phase upload flow.
 * Uses a 1x1 transparent PNG (67 bytes) as the dummy file, uploads it to
 * the real R2 dev bucket via presigned URL, then confirms the upload.
 */

// 1x1 transparent PNG — smallest valid PNG file (67 bytes)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

const createTinyPng = (): Uint8Array => {
  const binary = atob(TINY_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k='

const createTinyJpeg = (): Uint8Array => {
  const binary = atob(TINY_JPEG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export interface UploadAssetOptions {
  baseUrl: string
  token: string
  teamId: string
  fileName?: string
  mimeType?: string
}

export interface UploadedAsset {
  id: string
  teamId: string
  originalFilename: string
  fileSize: number
  mimeType: string
  assetType: string
  storagePath: string
  processingStatus: string
  createdAt: string
}

/**
 * Seeds a media asset through the full two-phase upload flow:
 * 1. POST /teams/:teamId/uploads/request → get presigned URL
 * 2. PUT file bytes to R2 presigned URL
 * 3. POST /teams/:teamId/uploads/:uploadId/confirm → creates asset record
 */
export const uploadTestAsset = async (options: UploadAssetOptions): Promise<UploadedAsset> => {
  const mimeType = options.mimeType ?? 'image/png'
  const fileName = options.fileName ?? `test-${Date.now()}.png`
  const fileBytes = mimeType === 'image/jpeg' ? createTinyJpeg() : createTinyPng()

  // Phase 1: Request upload
  const requestRes = await fetch(`${options.baseUrl}/v1/teams/${options.teamId}/uploads/request`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`
    },
    body: JSON.stringify({
      fileName,
      fileSize: fileBytes.length,
      contentHash: null,
      mimeType
    })
  })

  if (!requestRes.ok) {
    const body = await requestRes.text()
    throw new Error(`Upload request failed (${requestRes.status}): ${body}`)
  }

  const requestData = await requestRes.json() as {
    uploadId: string
    presignedUrl: string
    deduplicated: boolean
    existingAssetId: string | null
  }

  if (requestData.deduplicated) {
    // Asset already exists — fetch and return it
    const getRes = await fetch(
      `${options.baseUrl}/v1/teams/${options.teamId}/assets/${String(requestData.existingAssetId)}`,
      { headers: { authorization: `Bearer ${options.token}` } }
    )
    if (!getRes.ok) {
      const body = await getRes.text()
      throw new Error(`Failed to fetch deduplicated asset (${getRes.status}): ${body}`)
    }
    return await getRes.json() as UploadedAsset
  }

  // Phase 2: PUT file to R2 presigned URL
  const putRes = await fetch(requestData.presignedUrl, {
    method: 'PUT',
    body: Buffer.from(fileBytes),
    headers: { 'Content-Type': mimeType }
  })

  if (!putRes.ok) {
    const body = await putRes.text()
    throw new Error(`R2 PUT failed (${putRes.status}): ${body}`)
  }

  // Phase 3: Confirm upload
  const confirmRes = await fetch(
    `${options.baseUrl}/v1/teams/${options.teamId}/uploads/${requestData.uploadId}/confirm`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`
      }
    }
  )

  if (!confirmRes.ok) {
    const body = await confirmRes.text()
    throw new Error(`Upload confirm failed (${confirmRes.status}): ${body}`)
  }

  return await confirmRes.json() as UploadedAsset
}
