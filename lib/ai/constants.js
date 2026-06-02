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
export const DEFAULT_AI_MODEL = 'qwen3-coder-480b-a35b-instruct'
export const AI_REQUEST_TIMEOUT_MS = 55_000
/** Legacy name retained so the orchestrator import stays intact. */
export const DEFAULT_GEMINI_MODEL = DEFAULT_AI_MODEL

export const GEMINI_MODEL_FALLBACKS = [
  DEFAULT_AI_MODEL,
]

// ai_evaluation is versioned so internal rubric data can evolve without changing
// ai_feedback, the teacher-editable plain-text draft, or the submissions schema.
export const AI_EVALUATION_SCHEMA_VERSION = 2
