import { ChatOptions, GenerateOptions, OllamaClient } from "../types"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_RETRIES = 1
const LOCALHOST_RE = /\/\/localhost(?=:\d+|$)/

interface OllamaGenerateResponse {
  model: string
  response: string
  done: boolean
}

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

    try {
      return await this.fetchWithFallback({
        url,
        signal: opts.signal,
        fetcher: (u, s) => this.rawFetch(u, s, opts),
      })
    } catch (err) {
      throw enhanceError(err, url)
    }
  }

  async chat(opts: ChatOptions): Promise<string> {
    const url = this.normalizeUrl(opts.url, "/api/chat")

    try {
      return await this.fetchWithFallback({
        url,
        signal: opts.signal,
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

          const data = (await res.json()) as { message: { content: string } }
          return data.message.content
        },
      })
    } catch (err) {
      throw enhanceError(err, url)
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
      throw enhanceError(err, apiUrl)
    }
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

    const data = (await res.json()) as OllamaGenerateResponse
    return data.response
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

function resolveFetch(): typeof globalThis.fetch {
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis)
  }
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window)
  }
  if (typeof self !== "undefined" && typeof self.fetch === "function") {
    return self.fetch.bind(self)
  }
  throw new Error("fetch API недоступен в этом окружении")
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true
  return false
}

function isLocalhostUrl(url: string): boolean {
  return LOCALHOST_RE.test(url)
}

function enhanceError(err: unknown, url: string): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error("Превышен таймаут ожидания ответа от Ollama (120 сек)")
  }

  const rawMessage = err instanceof Error ? err.message : String(err)
  const errType = err instanceof Error ? err.constructor.name : typeof err

  if (err instanceof TypeError && rawMessage.includes("fetch")) {
    return new Error(
      `Не удалось выполнить запрос к Ollama по адресу ${url}. ` +
      `Ошибка: ${rawMessage}. ` +
      "Проверьте: 1) Ollama запущен (ollama serve) 2) брандмауэр не блокирует порт 11434",
    )
  }

  return new Error(`Ошибка (${errType}): ${rawMessage}`)
}
