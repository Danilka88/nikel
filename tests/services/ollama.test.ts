import { describe, it, expect, vi, beforeEach } from "vitest"
import { DefaultOllamaClient } from "../../src/services/ollama"

function createMockFetch(responses: Record<string, Partial<Response>>) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const entry = responses[url]
    if (!entry) {
      return new Response(null, { status: 404 })
    }
    return {
      ok: entry.ok ?? true,
      status: entry.status ?? 200,
      statusText: entry.statusText ?? "OK",
      json: async () => entry.json ?? {},
      text: async () => entry.text ?? "",
      headers: new Headers(),
      redirected: false,
      type: "basic" as ResponseType,
      url,
      clone: () => null as unknown as Response,
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as Response
  })
}

describe("DefaultOllamaClient", () => {
  let client: DefaultOllamaClient

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("generate", () => {
    it("returns response from a successful API call", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/generate": {
          ok: true,
          json: { model: "gemma4:e4b", response: "Hello!", done: true },
        },
      })
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
      const fetch = createMockFetch({
        "http://localhost:11434/api/generate": {
          ok: true,
          json: { model: "m", response: "ok", done: true },
        },
      })
      client = new DefaultOllamaClient(fetch)

      await client.generate({
        prompt: "hi",
        model: "m",
        url: "http://localhost:11434/",
      })

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.anything(),
      )
    })

    it("throws on HTTP error", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/generate": {
          ok: false,
          status: 500,
          text: "Internal Server Error",
        },
      })
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.generate({ prompt: "p", model: "m", url: "http://localhost:11434" }),
      ).rejects.toThrow("Ollama API error 500: Internal Server Error")
    })

    it("retries on TypeError (network error)", async () => {
      const fetch = vi.fn()
      fetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ model: "m", response: "ok", done: true }),
          text: async () => "",
          status: 200,
          statusText: "OK",
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
        } as Response)

      client = new DefaultOllamaClient(fetch)
      const result = await client.generate({
        prompt: "p",
        model: "m",
        url: "http://localhost:11434",
      })

      expect(result).toBe("ok")
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe("listModels", () => {
    it("returns model names from the API", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/tags": {
          ok: true,
          json: {
            models: [
              { name: "gemma4:e4b" },
              { name: "qwen3.5:4b" },
            ],
          },
        },
      })
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual(["gemma4:e4b", "qwen3.5:4b"])
    })

    it("returns empty array when no models", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/tags": {
          ok: true,
          json: { models: [] },
        },
      })
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual([])
    })

    it("handles missing models field gracefully", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/tags": {
          ok: true,
          json: {},
        },
      })
      client = new DefaultOllamaClient(fetch)

      const models = await client.listModels("http://localhost:11434")
      expect(models).toEqual([])
    })

    it("throws on HTTP error", async () => {
      const fetch = createMockFetch({
        "http://localhost:11434/api/tags": {
          ok: false,
          status: 503,
        },
      })
      client = new DefaultOllamaClient(fetch)

      await expect(
        client.listModels("http://localhost:11434"),
      ).rejects.toThrow("Failed to fetch models: 503")
    })
  })
})
