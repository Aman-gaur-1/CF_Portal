import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {
  buildAssistantResponseDiagnostics,
  buildStructuredOutputRequestControls,
  createStructuredOutputContractError,
  extractJsonPayload,
  inspectStructuredOutput,
  recoverStructuredOutput,
} from '../lib/ai/structured-output.mjs'

const { classifyProviderFailure, isFailoverEligibleError } = loadProviderManager()
const { sanitizeParserDiagnosticsForLog } = loadParserLogSanitizer()
const validJson = '{"score":8,"trainer_feedback":"Synthetic feedback."}'

const cases = [
  ['raw valid JSON is accepted', () => {
    assert.equal(inspectStructuredOutput(validJson).valid, true)
    assert.equal(inspectStructuredOutput(validJson).content_shape, 'raw_json')
  }],
  ['fenced valid JSON is accepted', () => {
    const result = inspectStructuredOutput(`\`\`\`json\n${validJson}\n\`\`\``)
    assert.equal(result.valid, true)
    assert.equal(result.content_shape, 'fenced_json')
  }],
  ['wrapped valid JSON is accepted', () => {
    const result = inspectStructuredOutput(`Evaluation follows:\n${validJson}\nDone.`)
    assert.equal(result.valid, true)
    assert.equal(result.content_shape, 'wrapped_json')
  }],
  ['shared extraction preserves wrapped-object semantics', () => {
    assert.equal(extractJsonPayload(`Before ${validJson} after`), validJson)
  }],
  ['plain text is rejected', () => {
    const result = inspectStructuredOutput('This submission looks good.')
    assert.equal(result.valid, false)
    assert.equal(result.content_shape, 'plain_text')
  }],
  ['incomplete JSON is rejected', () => {
    const result = inspectStructuredOutput('{"score": 8')
    assert.equal(result.valid, false)
    assert.equal(result.content_shape, 'incomplete_json')
  }],
  ['malformed JSON object is rejected', () => {
    const result = inspectStructuredOutput('{"score": nope}')
    assert.equal(result.valid, false)
    assert.equal(result.content_shape, 'malformed_json')
  }],
  ['first invalid and second valid succeeds on same provider/model', async () => {
    const calls = []
    const initial = fakeResult('plain text', 'nemotron', 'nvidia/test-model')
    const recovered = await recoverStructuredOutput(initial, {
      retry: async () => {
        calls.push(['nemotron', 'nvidia/test-model'])
        return fakeResult(validJson, 'nemotron', 'nvidia/test-model')
      },
    })
    assert.equal(recovered.valid, true)
    assert.deepEqual(calls, [['nemotron', 'nvidia/test-model']])
  }],
  ['successful recovery reports one structured retry', async () => {
    const recovered = await recoverStructuredOutput(fakeResult('plain text'), {
      retry: async () => fakeResult(validJson),
    })
    assert.equal(recovered.structured_retry_count, 1)
  }],
  ['two invalid responses produce typed contract error', async () => {
    const recovered = await recoverStructuredOutput(fakeResult('plain text'), {
      retry: async () => fakeResult('{"score": 8'),
    })
    assert.equal(recovered.valid, false)
    const error = createStructuredOutputContractError({ structuredRetryCount: 1 })
    assert.equal(error.code, 'AI_STRUCTURED_OUTPUT_INVALID')
  }],
  ['structured contract error carries safe diagnostics', () => {
    const response = buildAssistantResponseDiagnostics(fakeData('plain text'), 'plain text', {
      http_status: 200,
      response_format_requested: true,
    })
    const error = createStructuredOutputContractError({ responseDiagnostics: response, structuredRetryCount: 1 })
    assert.equal(error.runtimeDiagnostics.response.content_shape, 'plain_text')
    assert.equal(error.runtimeDiagnostics.structured_retry_count, 1)
  }],
  ['diagnostics exclude raw response text', () => {
    const secretText = 'private raw response body'
    const diagnostics = buildAssistantResponseDiagnostics(fakeData(secretText), secretText)
    assert.equal(JSON.stringify(diagnostics).includes(secretText), false)
  }],
  ['diagnostics exclude API keys and authorization headers', () => {
    const apiKey = 'nvapi-secret-value'
    const diagnostics = buildAssistantResponseDiagnostics(fakeData(validJson), validJson, {
      http_status: 200,
      response_format_requested: true,
      authorization: `Bearer ${apiKey}`,
    })
    const serialized = JSON.stringify(diagnostics)
    assert.equal(serialized.includes(apiKey), false)
    assert.equal(serialized.toLowerCase().includes('authorization'), false)
  }],
  ['compatibility retry metadata is preserved', () => {
    const diagnostics = buildAssistantResponseDiagnostics(fakeData(validJson), validJson, {
      http_status: 200,
      response_format_requested: true,
      response_format_removed_for_retry: true,
      retry_without_response_format: true,
    })
    assert.equal(diagnostics.response_format_removed_for_retry, true)
    assert.equal(diagnostics.retry_without_response_format, true)
  }],
  ['Nemotron 3 Super structured output disables reasoning', () => {
    assert.deepEqual(
      buildStructuredOutputRequestControls({
        model: 'nvidia/nemotron-3-super-120b-a12b',
        responseFormat: 'json_object',
      }),
      { chat_template_kwargs: { enable_thinking: false } }
    )
  }],
  ['reasoning control remains model and contract specific', () => {
    assert.deepEqual(
      buildStructuredOutputRequestControls({ model: 'poolside/laguna-xs-2.1', responseFormat: 'json_object' }),
      {}
    )
    assert.deepEqual(
      buildStructuredOutputRequestControls({ model: 'nvidia/nemotron-3-super-120b-a12b', responseFormat: null }),
      {}
    )
  }],
  ['request controls are captured without response content', () => {
    const diagnostics = buildAssistantResponseDiagnostics(fakeData(validJson), validJson, {
      thinking_disabled: true,
      max_tokens_requested: 1024,
    })
    assert.equal(diagnostics.thinking_disabled, true)
    assert.equal(diagnostics.max_tokens_requested, 1024)
    assert.equal(JSON.stringify(diagnostics).includes(validJson), false)
  }],
  ['parser diagnostics remove submission previews and snippets', () => {
    const sensitiveText = 'synthetic submission body that must never be logged'
    const diagnostics = sanitizeParserDiagnosticsForLog({
      characters: sensitiveText.length,
      normalized_text_preview: sensitiveText,
      header_preview: sensitiveText,
      bodySnippet: sensitiveText,
    })
    assert.equal(diagnostics.characters, sensitiveText.length)
    assert.equal(JSON.stringify(diagnostics).includes(sensitiveText), false)
    assert.equal(Object.keys(diagnostics).some(key => /preview|snippet/i.test(key)), false)
  }],
  ['extraction handoff source contains no direct text preview logging', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'ai', 'extract.js'), 'utf8')
    assert.equal(/finalTextPreview|cachedPreview/.test(source), false)
  }],
  ['first valid structured response has zero structured retries', async () => {
    const recovered = await recoverStructuredOutput(fakeResult(validJson), {
      retry: async () => { throw new Error('must not run') },
    })
    assert.equal(recovered.valid, true)
    assert.equal(recovered.structured_retry_count, 0)
  }],
  ['structured retry does not increment transient retry count', async () => {
    let transientRetryCount = 0
    const recovered = await recoverStructuredOutput(fakeResult('plain text'), {
      retry: async () => fakeResult(validJson),
    })
    assert.equal(recovered.structured_retry_count, 1)
    assert.equal(transientRetryCount, 0)
  }],
  ['structured violation does not invoke backup fallback', async () => {
    const attemptedProviders = []
    const providers = ['intentional-backup', 'unreachable-extra-provider']
    for (const provider of providers) {
      attemptedProviders.push(provider)
      const recovered = await recoverStructuredOutput(fakeResult('plain text', provider), {
        retry: async () => fakeResult('still plain text', provider),
      })
      if (!recovered.valid) {
        const error = createStructuredOutputContractError({ structuredRetryCount: 1 })
        if (!isFailoverEligibleError(error)) break
      }
    }
    assert.deepEqual(attemptedProviders, ['intentional-backup'])
  }],
  ['existing transient fallback classes remain eligible', () => {
    for (const status of [429, 503, 504]) assert.equal(isFailoverEligibleError({ status }), true)
    assert.equal(isFailoverEligibleError(new Error('network connection failed')), true)
    assert.equal(isFailoverEligibleError(new Error('request timeout')), true)
    assert.equal(classifyProviderFailure({ status: 429 }), 'rate_limit')
    assert.equal(classifyProviderFailure({ status: 503 }), 'service_unavailable')
    assert.equal(classifyProviderFailure({ status: 504 }), 'timeout')
  }],
  ['reasoning metadata does not replace valid content', () => {
    const data = fakeData(validJson, { reasoning_content: '{"different":true}' })
    const diagnostics = buildAssistantResponseDiagnostics(data, data.choices[0].message.content)
    assert.equal(diagnostics.content_shape, 'raw_json')
    assert.equal(diagnostics.reasoning_content_present, true)
  }],
  ['JSON in reasoning does not rescue invalid content', () => {
    const data = fakeData('plain text', { reasoning_content: validJson })
    const diagnostics = buildAssistantResponseDiagnostics(data, data.choices[0].message.content)
    assert.equal(diagnostics.content_shape, 'plain_text')
    assert.equal(inspectStructuredOutput(data.choices[0].message.content).valid, false)
  }],
  ['finish reason and response key metadata are captured safely', () => {
    const data = fakeData(validJson, { reasoning_content: 'internal reasoning' })
    const diagnostics = buildAssistantResponseDiagnostics(data, validJson)
    assert.equal(diagnostics.finish_reason, 'stop')
    assert.deepEqual(diagnostics.response_top_level_keys, ['choices', 'model'])
    assert.deepEqual(diagnostics.message_keys, ['content', 'reasoning_content', 'role'])
    assert.match(diagnostics.response_fingerprint, /^[a-f0-9]{16}$/)
  }],
  ['structured recovery is bounded to one callback invocation', async () => {
    let calls = 0
    const recovered = await recoverStructuredOutput(fakeResult('plain text'), {
      retry: async () => { calls += 1; return fakeResult('still plain text') },
    })
    assert.equal(recovered.valid, false)
    assert.equal(calls, 1)
  }],
  ['structured recovery can be skipped when timeout budget is insufficient', async () => {
    let calls = 0
    const recovered = await recoverStructuredOutput(fakeResult('plain text'), {
      canRetry: false,
      retry: async () => { calls += 1; return fakeResult(validJson) },
    })
    assert.equal(recovered.valid, false)
    assert.equal(recovered.structured_retry_count, 0)
    assert.equal(calls, 0)
  }],
]

let passed = 0
for (const [name, run] of cases) {
  await run()
  passed += 1
  console.log(`ok - ${name}`)
}
console.log(`\n${passed} AI provider contract tests passed.`)

function fakeData(content, extraMessage = {}) {
  return {
    model: 'nvidia/test-model',
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content, ...extraMessage },
    }],
  }
}

function fakeResult(text, provider = 'nemotron', model = 'nvidia/test-model') {
  return { text, provider, model, raw: fakeData(text) }
}

function loadProviderManager() {
  const file = path.join(process.cwd(), 'lib', 'ai', 'provider-manager.js')
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export async function /g, 'async function ')
    .replace(/export function /g, 'function ')
  const sandbox = {
    console,
    module: { exports: {} },
    getAiGenerationMode: async () => 'auto',
    getAiProviderCandidates: async () => [],
    isProviderCooling: () => false,
    providerHealthSummary: () => ({}),
  }
  vm.runInNewContext(`${source}\nmodule.exports = { classifyProviderFailure, isFailoverEligibleError };`, sandbox)
  return sandbox.module.exports
}

function loadParserLogSanitizer() {
  const file = path.join(process.cwd(), 'lib', 'ai', 'parsers', 'index.js')
  const source = fs.readFileSync(file, 'utf8')
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]\s*/g, '')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ')
  const sandbox = { console, module: { exports: {} } }
  vm.runInNewContext(`${source}\nmodule.exports = { sanitizeParserDiagnosticsForLog };`, sandbox)
  return sandbox.module.exports
}
