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
      ).rejects.toThrow("Превышен таймаут ожидания ответа от Ollama (120 сек)")
    })

    it("returns human-readable error for non-localhost TypeError", async () => {
      const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://192.168.1.100:11434" }),
      ).rejects.toThrow("Не удалось выполнить запрос к Ollama по адресу")
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
