import { ChatOptions, EmbeddingOptions, GenerateOptions, OllamaClient } from "../types"
import { timeoutSignal } from "../utils/timeout"
import { resolveFetch } from "../utils/fetch"
import { enhanceOllamaError, isLocalhostUrl, isRetryable, LOCALHOST_RE } from "../utils/network"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_RETRIES = 1

interface OllamaTagsResponse {
  models: { name: string }[]
}

export class DefaultOllamaClient implements OllamaClient {
  private _fetch: typeof globalThis.fetch

  constructor(fetchFn?: typeof globalThis.fetch) {
    this._fetch = fetchFn ?? resolveFetch()
  }

  async generate(opts: GenerateOptions): Promise<string> {
    const url = this.normalizeUrl(opts.url, "/api/generate")
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    let signal: AbortSignal | undefined
    let timeout: { signal: AbortSignal; clear: () => void } | null = null

    if (opts.signal) {
      signal = opts.signal
    } else {
      timeout = timeoutSignal(timeoutMs)
      signal = timeout.signal
    }

    try {
      return await this.fetchWithFallback({
        url,
        signal,
        fetcher: (u, s) => this.rawFetch(u, s, opts),
      })
    } catch (err) {
      throw enhanceOllamaError(err, url)
    } finally {
      timeout?.clear()
    }
  }

  async chat(opts: ChatOptions): Promise<string> {
    const url = this.normalizeUrl(opts.url, "/api/chat")
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    let signal: AbortSignal | undefined
    let timeout: { signal: AbortSignal; clear: () => void } | null = null

    if (opts.signal) {
      signal = opts.signal
    } else {
      timeout = timeoutSignal(timeoutMs)
      signal = timeout.signal
    }

    try {
      return await this.fetchWithFallback({
        url,
        signal,
        fetcher: async (u, s) => {
          const messages = opts.messages.map((m) => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content }
            if (m.images && m.images.length > 0) {
              msg.images = m.images
            }
            return msg
          })

          const body = JSON.stringify({
            model: opts.model,
            messages,
            stream: false,
          })

          const res = await this._fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: s,
            body,
          })

          if (!res.ok) {
            const text = await res.text()
            throw new Error(`HTTP ${res.status}: ${text}`)
          }

          const data = await res.json() as Record<string, unknown>
          if (!data || typeof data.message !== "object" || data.message === null || typeof (data.message as Record<string, unknown>).content !== "string") {
            const errorMsg = typeof data.error === "string" ? data.error : "неизвестный формат ответа Ollama"
            throw new Error(`Некорректный ответ Ollama: ${errorMsg}`)
          }
          return (data.message as Record<string, unknown>).content as string
        },
      })
    } catch (err) {
      throw enhanceOllamaError(err, url)
    } finally {
      timeout?.clear()
    }
  }

  async listModels(url: string): Promise<string[]> {
    const apiUrl = this.normalizeUrl(url, "/api/tags")

    try {
      return await this.fetchWithFallback({
        url: apiUrl,
        fetcher: async (u) => {
          const res = await this.fetchWithTimeout(u)
          if (!res.ok) {
            throw new Error(`Failed to fetch models: ${res.status}`)
          }
          const data = (await res.json()) as OllamaTagsResponse
          return (data.models || []).map((m) => m.name)
        },
      })
    } catch (err) {
      throw enhanceOllamaError(err, apiUrl)
    }
  }

  async getEmbeddings(opts: EmbeddingOptions): Promise<number[][]> {
    const url = this.normalizeUrl(opts.url, "/api/embed")
    const body = JSON.stringify({ model: opts.model, input: opts.input })
    const res = await this._fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    const data = (await res.json()) as Record<string, unknown>
    if (Array.isArray(data.embeddings)) return data.embeddings as number[][]
    throw new Error(`Некорректный ответ embeddings: ${typeof data.error === "string" ? data.error : "неизвестный формат"}`)
  }

  private async rawFetch(
    url: string,
    signal: AbortSignal | undefined,
    opts: GenerateOptions,
  ): Promise<string> {
    const body = JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      stream: false,
    })

    const res = await this._fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    const data = await res.json() as Record<string, unknown>
    if (typeof data.response !== "string") {
      const errorMsg = typeof data.error === "string" ? data.error : "неизвестный формат ответа Ollama"
      throw new Error(`Некорректный ответ Ollama: ${errorMsg}`)
    }
    return data.response as string
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS)
    try {
      return await this._fetch(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchWithFallback<T>(
    opts: { url: string; signal?: AbortSignal; fetcher: (url: string, signal?: AbortSignal) => Promise<T> },
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await opts.fetcher(opts.url, opts.signal)
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryable(err)) continue
        if (isRetryable(err) && isLocalhostUrl(opts.url)) {
          const fallbackUrl = opts.url.replace(LOCALHOST_RE, "//127.0.0.1")
          try {
            return await opts.fetcher(fallbackUrl, opts.signal)
          } catch {
            // throw original error
          }
        }
        throw err
      }
    }
    throw new Error("Unreachable")
  }

  private normalizeUrl(base: string, path: string): string {
    return `${base.replace(/\/$/, "")}${path}`
  }
}


