export {
  clearAiEnvOverrides,
  getAiEnv,
  setAiEnvOverride,
  type AiEnv
} from './env.js'
export { AiError } from './errors.js'
export {
  callModel,
  resetOpenRouterClientForTests,
  setOpenRouterHttpClientForTests
} from './openrouter.js'
export {
  embeddingsGenerate,
  resetEmbeddingsClientForTests,
  setEmbeddingsHttpClientForTests
} from './embeddings.js'
export {
  tracedCallModel,
  withAgentStep,
  withAgentTrace
} from './tracing.js'
export type { TracedCallModelOptions } from './tracing.js'
export type * from '@openrouter/sdk'
export type * from './openrouter.js'
export type * from './embeddings.js'
