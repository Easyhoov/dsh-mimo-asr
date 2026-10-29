/**
 * Xiaomi MiMo cloud recognizer for DSH.
 *
 * DSH Go's composer microphone speaks only the `speech` Remote:
 * `speech/catalog` (which recognizers exist, which is selected, intake limits)
 * and `speech/transcribe` (one complete WAV -> final text). This package plugs a
 * `location: 'cloud'` provider into that Remote, so dictation works with no
 * model download at all.
 *
 * Contract (from @deepseek-ai/dsh-experimental-speech-to-text):
 *   SpeechProvider     = { info, preparation?, transcribe(input, signal) }
 *   SpeechProviderInfo = { id, name, location: 'host-local' | 'cloud', languages }
 *   Transcribe         = { text, audioSeconds, inferenceSeconds }
 *
 * A provider without `preparation` reports phase 'ready' immediately, which is
 * exactly what a cloud recognizer is: nothing to download, nothing to load.
 *
 * Settings: the Host settings service derives a form from `Config` and lists it
 * for this profile entry (DSH Go: 设置 › 插件 › dsh-mimo-asr › 设置, and
 * 设置 › 引擎参数). Only fields marked `volatile` become form fields, and a
 * volatile field resolves to a ref, so reading it per request means a key typed
 * into the form applies to the next recording without restarting the engine.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

export const name = 'mimo-cloud-asr'
/**
 * Only the registry is required. `settings` is optional: the Host settings
 * service reads this plugin's Config on its own, so nothing here injects it and
 * a Host without Settings still runs the recognizer.
 */
export const inject = ['speechToText']

const API_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions'
const TOKEN_PLAN_ENDPOINTS = {
  cn: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
  sgp: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
  ams: 'https://token-plan-ams.xiaomimimo.com/v1/chat/completions',
}

/** Fallbacks so the key never has to sit in a profile patch file. */
const ENV_KEY = 'MIMO_API_KEY'
const KEY_FILE = path.join(os.homedir(), '.dsh', 'mimo-asr.key')

export const Config = z.object({
  providerId: z.string().min(1).default('mimo-cloud').description('Provider id reported by speech/catalog; must match the registry defaultProvider'),
  // Volatile: rendered as a secret field in the plugin settings form, and read
  // through its ref on every request. Empty falls back to env, then the key file.
  apiKey: z.string().role('secret').default('').volatile().description('Xiaomi MiMo API key (sk-... for API, tp-... for Token Plan). Empty falls back to $MIMO_API_KEY, then ~/.dsh/mimo-asr.key'),
  access: z.union(['api', 'token-plan']).default('api').volatile().description('MiMo access method: api, token-plan'),
  cluster: z.union(['cn', 'sgp', 'ams']).default('cn').volatile().description('Token Plan cluster (only used by access: token-plan)'),
  model: z.string().min(1).default('mimo-v2.5-asr').volatile().description('MiMo ASR model id'),
  language: z.union(['auto', 'zh', 'en']).default('auto').volatile().description('Recognition language hint'),
  timeoutMs: z.natural().min(1000).default(120000).description('Per-recording request timeout in milliseconds'),
})

/** Volatile fields resolve to refs; ordinary fields are already plain values. */
function readField(field, fallback) {
  const live = field !== null && typeof field === 'object' && typeof field.get === 'function' ? field.get() : field
  return live === undefined || live === null ? fallback : live
}

/** Snapshot the live configuration once per request. */
function readConfig(config) {
  return {
    apiKey: String(readField(config.apiKey, '')).trim(),
    access: readField(config.access, 'api'),
    cluster: readField(config.cluster, 'cn'),
    model: readField(config.model, 'mimo-v2.5-asr'),
    language: readField(config.language, 'auto'),
    timeoutMs: readField(config.timeoutMs, 120000),
  }
}

/** `mimo-cloud` when the app sends nothing, otherwise follow what it asked for. */
function languageFor(configured, requested) {
  if (configured !== 'auto') return configured
  const base = String(requested ?? '').trim().toLowerCase().split('-', 1)[0]
  return base === 'zh' || base === 'en' ? base : 'auto'
}

function endpointFor(config) {
  if (config.access === 'token-plan') return TOKEN_PLAN_ENDPOINTS[config.cluster] ?? TOKEN_PLAN_ENDPOINTS.cn
  return API_ENDPOINT
}

function resolveKey(config) {
  if (config.apiKey) return config.apiKey
  const env = String(process.env[ENV_KEY] ?? '').trim()
  if (env) return env
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/** Where the key came from, without echoing it — one line a bug report can read. */
function keySource(config) {
  if (config.apiKey) return 'settings form'
  if (String(process.env[ENV_KEY] ?? '').trim()) return `$${ENV_KEY}`
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim() ? KEY_FILE : 'none'
  } catch {
    return 'none'
  }
}

/** Hosts often swallow plugin warnings; this file is what a bug report can read. */
function diagnostic(line) {
  try {
    fs.appendFileSync(path.join(os.homedir(), '.dsh', 'mimo-asr.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // logging must never break activation
  }
}

function withTimeout(signal, ms) {
  if (typeof AbortSignal.any !== 'function' || typeof AbortSignal.timeout !== 'function') return signal
  return AbortSignal.any([signal, AbortSignal.timeout(ms)])
}

/**
 * Register the recognizer.
 *
 * The Host settings form writes the volatile fields of this entry; because the
 * refs live in the config object handed to `apply`, reading them per request is
 * enough for a new key, model, or access method to take effect immediately.
 *
 * @param ctx - host context that owns the speech registry.
 * @param config - validated plugin configuration, including volatile refs.
 */
export function apply(ctx, config) {
  const settings = () => readConfig(config)

  // Fail at activation rather than at the first recording.
  new URL(endpointFor(settings()))
  diagnostic(`activated; api key source: ${keySource(settings())}`)

  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId,
        name: 'Xiaomi MiMo ASR',
        location: 'cloud',
        languages: ['auto', 'zh', 'en'],
      },
      async transcribe(input, signal) {
        const current = settings()
        const key = resolveKey(current)
        if (!key) {
          throw new Error(
            'MiMo ASR: no API key. Set it in 设置 › 插件 › dsh-mimo-asr › 设置 › API key, ' +
              `or write ${KEY_FILE}, or export ${ENV_KEY}.`,
          )
        }
        const startedAt = Date.now()
        const body = {
          model: current.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    // The app always records 16 kHz mono PCM16, i.e. plain WAV.
                    data: `data:audio/wav;base64,${Buffer.from(input.audio).toString('base64')}`,
                    format: 'wav',
                  },
                },
              ],
            },
          ],
          asr_options: { language: languageFor(current.language, input.language) },
        }
        const response = await fetch(endpointFor(current), {
          method: 'POST',
          headers: { 'api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: withTimeout(signal, current.timeoutMs),
        })
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).slice(0, 200)
          throw new Error(`MiMo ASR HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
        }
        const parsed = await response.json()
        const content = parsed?.choices?.[0]?.message?.content
        const text = typeof content === 'string' ? content.trim() : ''
        const reported = Number(parsed?.usage?.seconds)
        return {
          text,
          audioSeconds: Number.isFinite(reported) ? reported : input.audio.length / 32000,
          inferenceSeconds: (Date.now() - startedAt) / 1000,
        }
      },
    })
    return () => unregister()
  })
}
