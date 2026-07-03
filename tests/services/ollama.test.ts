import { describe, it, expect, vi } from "vitest"
import { DefaultOllamaClient } from "../../src/services/ollama"

function mockResponse(overrides: { ok?: boolean; status?: number; text?: string; json?: any } = {}): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: "OK",
    json: async () => overrides.json ?? {},
    text: async () => overrides.text ?? "",
    headers: new Headers(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    clone: () => null as unknown as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response
}

describe("DefaultOllamaClient", () => {
  let client: DefaultOllamaClient

  describe("generate", () => {
    it("returns response from a successful API call", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { model: "gemma4:e4b", response: "Hello!", done: true } }),
      )
      client = new DefaultOllamaClient(fetch)

      const result = await client.generate({
        prompt: "test prompt",
        model: "gemma4:e4b",
        url: "http://localhost:11434",
      })

      expect(result).toBe("Hello!")
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"prompt":"test prompt"'),
        }),
      )
    })

    it("normalizes URL by removing trailing slash", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { model: "m", response: "ok", done: true } }),
      )
      client = new DefaultOllamaClient(fetch)

      await client.generate({ prompt: "hi", model: "m", url: "http://localhost:11434/" })

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.anything(),
      )
    })

    it("throws on HTTP 500", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ ok: false, status: 500, text: "Internal Server Error" }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://localhost:11434" }),
      ).rejects.toThrow("Ошибка (Error): HTTP 500: Internal Server Error")
    })

    it("retries on TypeError and succeeds on second attempt", async () => {
      const fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockResponse({ json: { model: "m", response: "ok", done: true } }))
      client = new DefaultOllamaClient(fetch)

      const result = await client.generate({
        prompt: "p",
        model: "m",
        url: "http://127.0.0.1:11434",
      })

      expect(result).toBe("ok")
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it("falls back to 127.0.0.1 when localhost fails with TypeError", async () => {
      const fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockResponse({ json: { model: "m", response: "fallback ok", done: true } }))
      client = new DefaultOllamaClient(fetch)

      const result = await client.generate({
        prompt: "p",
        model: "m",
        url: "http://localhost:11434",
      })

      expect(result).toBe("fallback ok")
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(fetch.mock.calls[2][0]).toBe("http://127.0.0.1:11434/api/generate")
    })

    it("returns human-readable error on TypeError when all attempts fail", async () => {
      const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://localhost:11434" }),
      ).rejects.toThrow("Не удалось выполнить запрос к Ollama по адресу http://localhost:11434/api/generate.")
    })

    it("returns human-readable error on timeout", async () => {
      const fetch = vi.fn().mockRejectedValue(
        new DOMException("The operation was aborted", "AbortError"),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://localhost:11434" }),
      ).rejects.toThrow("Превышен таймаут ожидания ответа от Ollama")
    })

    it("throws on malformed response — no response field", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { error: "internal error" } }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://localhost:11434" }),
      ).rejects.toThrow("Некорректный ответ Ollama: internal error")
    })

    it("returns human-readable error for non-localhost TypeError", async () => {
      const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://192.168.1.100:11434" }),
      ).rejects.toThrow("Не удалось выполнить запрос к Ollama по адресу")
    })
  })

  describe("chat", () => {
    it("returns content from a successful chat API call", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { message: { role: "assistant", content: "Привет!" } } }),
      )
      client = new DefaultOllamaClient(fetch)

      const result = await client.chat({
        model: "gemma4:e4b",
        url: "http://localhost:11434",
        messages: [{ role: "user", content: "скажи привет" }],
      })

      expect(result).toBe("Привет!")
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"role":"user"'),
        }),
      )
    })

    it("sends images in the request when provided", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { message: { role: "assistant", content: "Вижу изображение" } } }),
      )
      client = new DefaultOllamaClient(fetch)

      const result = await client.chat({
        model: "gemma4:e4b",
        url: "http://localhost:11434",
        messages: [{ role: "user", content: "что на картинке?", images: ["base64data=="] }],
      })

      expect(result).toBe("Вижу изображение")
      const body = JSON.parse(fetch.mock.calls[0][1].body)
      expect(body.messages[0].images).toEqual(["base64data=="])
    })

    it("throws on HTTP error", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ ok: false, status: 404, text: "model not found" }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.chat({ model: "m", url: "http://localhost:11434", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow("HTTP 404: model not found")
    })

    it("throws on malformed response — no message field", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { error: "model not available" } }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.chat({ model: "m", url: "http://localhost:11434", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow("Некорректный ответ Ollama: model not available")
    })

    it("throws on malformed response — message without content", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { message: { role: "assistant" } } }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.chat({ model: "m", url: "http://localhost:11434", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow("Некорректный ответ Ollama: неизвестный формат ответа Ollama")
    })

    it("retries on TypeError and succeeds on second attempt", async () => {
      const fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockResponse({ json: { message: { role: "assistant", content: "ok" } } }))
      client = new DefaultOllamaClient(fetch)

      const result = await client.chat({
        model: "m",
        url: "http://localhost:11434",
        messages: [{ role: "user", content: "hi" }],
      })

      expect(result).toBe("ok")
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe("getEmbeddings", () => {
    it("returns embeddings array from a successful API call", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { model: "nomic-embed-text", embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] } }),
      )
      client = new DefaultOllamaClient(fetch)

      const result = await client.getEmbeddings({
        model: "nomic-embed-text",
        url: "http://localhost:11434",
        input: ["text one", "text two"],
      })

      expect(result).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/embed",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"input":["text one","text two"]'),
        }),
      )
    })

    it("returns array for single string input", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { model: "nomic-embed-text", embeddings: [[0.1, 0.2]] } }),
      )
      client = new DefaultOllamaClient(fetch)

      const result = await client.getEmbeddings({
        model: "nomic-embed-text",
        url: "http://localhost:11434",
        input: "single query",
      })

      expect(result).toEqual([[0.1, 0.2]])
    })

    it("throws on HTTP error", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ ok: false, status: 404, text: "model not found" }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.getEmbeddings({ model: "x", url: "http://localhost:11434", input: "test" }),
      ).rejects.toThrow("HTTP 404: model not found")
    })

    it("throws on malformed response — no embeddings field", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { error: "failed to generate" } }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.getEmbeddings({ model: "x", url: "http://localhost:11434", input: "test" }),
      ).rejects.toThrow("Некорректный ответ embeddings: failed to generate")
    })

    it("throws on malformed response — embeddings not an array", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { model: "x", embeddings: "not_array" } }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.getEmbeddings({ model: "x", url: "http://localhost:11434", input: "test" }),
      ).rejects.toThrow("Некорректный ответ embeddings: неизвестный формат")
    })
  })

  describe("listModels", () => {
    it("returns model names from the API", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ json: { models: [{ name: "gemma4:e4b" }, { name: "qwen3.5:4b" }] } }),
      )
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual(["gemma4:e4b", "qwen3.5:4b"])
    })

    it("returns empty array when no models", async () => {
      const fetch = vi.fn().mockResolvedValue(mockResponse({ json: { models: [] } }))
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual([])
    })

    it("handles missing models field gracefully", async () => {
      const fetch = vi.fn().mockResolvedValue(mockResponse({ json: {} }))
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual([])
    })

    it("throws on HTTP error", async () => {
      const fetch = vi.fn().mockResolvedValue(
        mockResponse({ ok: false, status: 503 }),
      )
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.listModels("http://localhost:11434"),
      ).rejects.toThrow("Failed to fetch models: 503")
    })

    it("falls back to 127.0.0.1 when localhost fails with TypeError", async () => {
      const fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockResponse({ json: { models: [{ name: "m" }] } }))
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual(["m"])
      expect(fetch.mock.calls[2][0]).toBe("http://127.0.0.1:11434/api/tags")
    })
  })
})
