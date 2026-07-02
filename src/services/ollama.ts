import { GenerateOptions, OllamaClient } from "../types"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_RETRIES = 1

interface OllamaGenerateResponse {
  model: string
  response: string
  done: boolean
}

interface OllamaModel {
  name: string
}

interface OllamaTagsResponse {
  models: OllamaModel[]
}

export class DefaultOllamaClient implements OllamaClient {
  constructor(
    private _fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async generate(opts: GenerateOptions): Promise<string> {
    const url = this.normalizeUrl(opts.url, "/api/generate")
    const timeout = opts.signal
      ? undefined
      : AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    const signal = opts.signal ?? timeout

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
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
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryable(err)) continue
        throw err
      }
    }

    throw new Error("Unreachable")
  }

  async listModels(url: string): Promise<string[]> {
    const apiUrl = this.normalizeUrl(url, "/api/tags")

    const res = await this._fetch(apiUrl)
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`)
    }

    const data = (await res.json()) as OllamaTagsResponse
    return (data.models || []).map((m) => m.name)
  }

  private normalizeUrl(base: string, path: string): string {
    return `${base.replace(/\/$/, "")}${path}`
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && err.name === "AbortError") return false
  return false
}
