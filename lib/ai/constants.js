export const AI_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
}

export const DEFAULT_PHASE = 'Python'
export const MAX_SUBMISSION_CHARS = 50_000
export const MAX_EXTRACTED_FILE_CHARS = 40_000
export const RETRIEVAL_CHUNK_LIMIT = 8
export const RETRIEVAL_MIN_CHUNKS = 3
/** NVIDIA OpenAI-compatible defaults. Override with AI_MODEL / AI_BASE_URL. */
export const DEFAULT_AI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
export const DEFAULT_AI_MODEL = 'nvidia/llama-3.1-nemotron-nano-8b-v1'
export const AI_REQUEST_TIMEOUT_MS = 38_000
export const AI_PROVIDER_TIMEOUTS_MS = {
  openrouter: 45_000,
  step: 45_000,
  qwen: 45_000,
  nvidia: 45_000,
  nemotron: 45_000,
  default: 38_000,
}
export const AI_EVALUATION_TIMEOUT_MS = 48_000
export const AI_PROVIDER_TIMEOUT_SAFETY_MS = 2_500
export const AI_MAX_CONCURRENT_EVALUATIONS = 2
export const AI_RETRY_COOLDOWN_MS = 1_200
export const AI_QUEUE_ITEM_COOLDOWN_MS = 750
export const AI_SINGLE_QUEUE_LIMIT = 20
/** Legacy name retained so the orchestrator import stays intact. */
export const DEFAULT_GEMINI_MODEL = DEFAULT_AI_MODEL

export const GEMINI_MODEL_FALLBACKS = [
  DEFAULT_AI_MODEL,
]

// ai_evaluation is versioned so internal rubric data can evolve without changing
// ai_feedback, the teacher-editable plain-text draft, or the submissions schema.
export const AI_EVALUATION_SCHEMA_VERSION = 3
