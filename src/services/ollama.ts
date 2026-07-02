import { GenerateOptions, OllamaClient } from "../types"

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
  constructor(
    private _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async generate(opts: GenerateOptions): Promise<string> {
    const url = this.normalizeUrl(opts.url, "/api/generate")
    const { signal, cleanup } = opts.signal
      ? { signal: opts.signal, cleanup: () => {} }
      : createTimeoutSignal(DEFAULT_TIMEOUT_MS)

    try {
      return await this.fetchWithFallback({
        url,
        signal,
        fetcher: (u, s) => this.doGenerate(u, s, opts),
      })
    } catch (err) {
      throw humanReadableError(err, url)
    } finally {
      cleanup()
    }
  }

  private async doGenerate(
    url: string,
    signal: AbortSignal,
    opts: GenerateOptions,
  ): Promise<string> {
    const res = await this._fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        stream: false,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as OllamaGenerateResponse
    return data.response
  }

  async listModels(url: string): Promise<string[]> {
    const apiUrl = this.normalizeUrl(url, "/api/tags")

    try {
      return await this.fetchWithFallback({
        url: apiUrl,
        fetcher: async (u) => {
          const res = await this._fetch(u)
          if (!res.ok) {
            throw new Error(`Failed to fetch models: ${res.status}`)
          }
          const data = (await res.json()) as OllamaTagsResponse
          return (data.models || []).map((m) => m.name)
        },
      })
    } catch (err) {
      throw humanReadableError(err, apiUrl)
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
            // fall through, throw original error
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

function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, cleanup: () => clearTimeout(timer) }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && err.name === "AbortError") return false
  return false
}

function isLocalhostUrl(url: string): boolean {
  return LOCALHOST_RE.test(url)
}

function humanReadableError(err: unknown, url: string): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error("Превышен таймаут ожидания ответа от Ollama (120 сек)")
  }
  if (err instanceof TypeError) {
    return new Error(
      `Не удалось подключиться к Ollama по адресу ${url}. ` +
      "Проверьте: 1) Ollama запущен (ollama serve) 2) брандмауэр не блокирует порт 11434",
    )
  }
  return err as Error
}
