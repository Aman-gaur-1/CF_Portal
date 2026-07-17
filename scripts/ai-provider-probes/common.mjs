import crypto from 'crypto'
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

export const TARGET_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
export const TIMEOUT_MS = Number.parseInt(process.env.AI_PROBE_TIMEOUT_MS || '', 10) || 45_000

export function now() {
  return new Date().toISOString()
}

export function log(event, payload = {}) {
  console.log(JSON.stringify({ ts: now(), event, ...payload }, null, 2))
}

export function loadDotEnv(path = '.env.local') {
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

export async function getProviderRequest(priority = 1) {
  loadDotEnv()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env for provider lookup')

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: row, error } = await supabase
    .from('ai_provider_settings')
    .select('*')
    .eq('priority', priority)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!row) throw new Error(`No provider row found for priority ${priority}`)

  const apiKey = decryptSecret(row.encrypted_api_key)
  const body = {
    model: row.model,
    messages: [
      {
        role: 'user',
        content: 'Respond with a short plain-text acknowledgement.',
      },
    ],
    temperature: 0,
    max_tokens: 64,
  }

  return {
    row,
    apiKey,
    url: TARGET_URL,
    body,
    bodyText: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    safeHeaders: {
      'Content-Type': 'application/json',
      Authorization: '[redacted]',
    },
  }
}

export function redact(text, apiKey) {
  return String(text || '').replaceAll(apiKey || '', '[redacted]')
}

export function snippet(text, limit = 1000) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function decryptSecret(value) {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || '').split(':')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Unsupported encrypted secret format')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function getEncryptionKey() {
  const secret =
    process.env.AI_SETTINGS_ENCRYPTION_KEY ||
    process.env.SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY

  if (!secret) throw new Error('Missing AI settings encryption key source')
  return crypto.createHash('sha256').update(String(secret)).digest().subarray(0, 32)
}
