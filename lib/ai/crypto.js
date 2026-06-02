import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

export function encryptSecret(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export function decryptSecret(value) {
  const text = String(value || '').trim()
  if (!text) return ''

  const [version, ivValue, tagValue, ciphertextValue] = text.split(':')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Unsupported encrypted secret format')
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function maskSecret(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= 8) return `${text.slice(0, 2)}...${text.slice(-2)}`
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function getEncryptionKey() {
  const secret =
    process.env.AI_SETTINGS_ENCRYPTION_KEY ||
    process.env.SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY

  if (!secret) {
    throw new Error('Missing AI_SETTINGS_ENCRYPTION_KEY for encrypted AI provider keys')
  }

  return crypto.createHash('sha256').update(String(secret)).digest().subarray(0, KEY_BYTES)
}
