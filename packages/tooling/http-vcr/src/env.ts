export const shouldRecordHttpVcr = (): boolean =>
  process.env.HTTP_VCR_RECORD === '1'
