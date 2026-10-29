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
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

export const name = 'mimo-cloud-asr'
/** The registry and the Remote controller both come from the profile's other entries. */
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
  apiKey: z.string().role('secret').default('').description('Xiaomi MiMo API key (sk-... for API, tp-... for Token Plan). Empty falls back to $MIMO_API_KEY, then ~/.dsh/mimo-asr.key'),
  access: z.union(['api', 'token-plan']).default('api').description('MiMo access method: api, token-plan'),
  cluster: z.union(['cn', 'sgp', 'ams']).default('cn').description('Token Plan cluster (only used by access: token-plan)'),
  model: z.string().min(1).default('mimo-v2.5-asr').description('MiMo ASR model id'),
  language: z.union(['auto', 'zh', 'en']).default('auto').description('Recognition language hint'),
  timeoutMs: z.natural().min(1000).default(120000).description('Per-recording request timeout in milliseconds'),
})

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
  const inline = String(config.apiKey ?? '').trim()
  if (inline) return inline
  const env = String(process.env[ENV_KEY] ?? '').trim()
  if (env) return env
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

function withTimeout(signal, ms) {
  if (typeof AbortSignal.any !== 'function' || typeof AbortSignal.timeout !== 'function') return signal
  return AbortSignal.any([signal, AbortSignal.timeout(ms)])
}

/**
 * Register the recognizer. Cloud providers never download or load anything, so
 * no `preparation` is declared and `speech/catalog` reports it ready.
 *
 * @param ctx - host context that owns the speech registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config) {
  const endpoint = endpointFor(config)
  // Fail at activation rather than at the first recording.
  new URL(endpoint)

  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId,
        name: 'Xiaomi MiMo ASR',
        location: 'cloud',
        languages: ['auto', 'zh', 'en'],
      },
      async transcribe(input, signal) {
        const key = resolveKey(config)
        if (!key) {
          throw new Error(
            'MiMo ASR: no API key. Set it in 设置 › 引擎参数 › dsh-mimo-asr, ' +
              `or write ${KEY_FILE}, or export ${ENV_KEY}.`,
          )
        }
        const startedAt = Date.now()
        const body = {
          model: config.model,
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
          asr_options: { language: languageFor(config.language, input.language) },
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: withTimeout(signal, config.timeoutMs),
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
