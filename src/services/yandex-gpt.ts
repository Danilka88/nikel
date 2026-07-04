import { ChatOptions, EmbeddingOptions, GenerateOptions, OllamaClient } from "../types"

const DEFAULT_BASE_URL = "https://llm.api.cloud.yandex.net/v1"
const DEFAULT_TIMEOUT_MS = 120_000
const KNOWN_MODELS = ["yandexgpt/latest", "yandexgpt-pro/latest", "yandexgpt-lite/latest"]

interface YandexChatResponse {
  choices?: { message?: { content?: string } }[]
  error?: string
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

export class YandexGPTClient implements OllamaClient {
  private _fetch: typeof globalThis.fetch

  constructor(
    private _apiKey: string,
    private _folderId: string,
    private _baseUrl: string = DEFAULT_BASE_URL,
    fetchFn?: typeof globalThis.fetch,
  ) {
    this._fetch = fetchFn ?? resolveFetch()
  }

  async generate(opts: GenerateOptions): Promise<string> {
    return this.chat({
      model: opts.model,
      url: opts.url,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      messages: [{ role: "user", content: opts.prompt }],
    })
  }

  async chat(opts: ChatOptions): Promise<string> {
    const url = `${this._baseUrl}/chat/completions`
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
      const modelUri = this.buildModelUri(opts.model)
      const body = JSON.stringify({
        model: modelUri,
        messages: opts.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      })

      const res = await this._fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Api-Key ${this._apiKey}`,
          "x-folder-id": this._folderId,
          "x-data-logging-enabled": "false",
        },
        signal,
        body,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }

      const data = (await res.json()) as YandexChatResponse

      if (data.error) {
        throw new Error(`YandexGPT API error: ${data.error}`)
      }

      const content = data.choices?.[0]?.message?.content
      if (typeof content !== "string") {
        throw new Error("Пустой ответ YandexGPT")
      }

      return content
    } catch (err) {
      throw this.enhanceError(err, url)
    } finally {
      timeout?.clear()
    }
  }

  async getEmbeddings(_opts: EmbeddingOptions): Promise<number[][]> {
    throw new Error("YandexGPT не поддерживает генерацию эмбеддингов. Используйте Ollama для этой функции.")
  }

  async listModels(_url: string): Promise<string[]> {
    return [...KNOWN_MODELS]
  }

  private buildModelUri(model: string): string {
    if (model.startsWith("gpt://") || model.startsWith("ds://")) return model
    if (this._folderId) return `gpt://${this._folderId}/${model}`
    return model
  }

  private enhanceError(err: unknown, url: string): Error {
    if (err instanceof Error && err.name === "AbortError") {
      return new Error("Превышен таймаут ожидания ответа от YandexGPT. Попробуйте увеличить таймаут.")
    }

    if ((err instanceof TypeError || (err instanceof Error && err.name === "TypeError")) && err.message.includes("fetch")) {
      return new Error(
        `Не удалось выполнить запрос к YandexGPT по адресу ${url}. ` +
        "Проверьте: 1) API-ключ корректен 2) folder ID указан 3) есть доступ к Yandex Cloud",
      )
    }

    return err instanceof Error ? err : new Error(String(err))
  }
}

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  }
}
