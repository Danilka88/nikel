import { describe, it, expect, vi } from "vitest"
import { YandexGPTClient } from "../../src/services/yandex-gpt"

const API_KEY = "test-api-key"
const FOLDER_ID = "b1gtestfolder"

function mockFetch(data: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), { status }),
  ) as unknown as typeof globalThis.fetch
}

function mockFetchError(message: string, type = "TypeError"): typeof globalThis.fetch {
  const err = new Error(message)
  err.name = type
  return vi.fn().mockRejectedValue(err) as unknown as typeof globalThis.fetch
}

const mockCalls = (fetch: typeof globalThis.fetch) =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls

describe("YandexGPTClient", () => {
  describe("chat", () => {
    it("отправляет запрос и возвращает ответ", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "Привет" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      const result = await client.chat({
        model: "yandexgpt/latest",
        url: "https://llm.api.cloud.yandex.net/v1",
        messages: [{ role: "user", content: "скажи привет" }],
      })

      expect(result).toBe("Привет")

      const calls = mockCalls(fetch)
      const callUrl = calls[0][0]
      const callBody = JSON.parse(calls[0][1].body as string)
      const callHeaders = calls[0][1].headers as Record<string, string>

      expect(callUrl).toBe("https://llm.api.cloud.yandex.net/v1/chat/completions")
      expect(callBody.model).toBe("gpt://b1gtestfolder/yandexgpt/latest")
      expect(callHeaders.Authorization).toBe("Api-Key test-api-key")
      expect(callHeaders["x-folder-id"]).toBe("b1gtestfolder")
      expect(callHeaders["x-data-logging-enabled"]).toBe("false")
    })

    it("выбрасывает ошибку при HTTP ошибке", async () => {
      const fetch = mockFetch({ error: "unauthorized" }, 401)
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/HTTP 401/)
    })

    it("выбрасывает ошибку при пустом ответе", async () => {
      const fetch = mockFetch({ choices: [] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/Пустой ответ/)
    })

    it("выбрасывает ошибку при отсутствии choices", async () => {
      const fetch = mockFetch({})
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/Пустой ответ/)
    })

    it("выбрасывает ошибку API из поля error", async () => {
      const fetch = mockFetch({ error: "model not found" })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/YandexGPT API error: model not found/)
    })

    it("обрабатывает сетевую ошибку с русским сообщением", async () => {
      const fetch = mockFetchError("Failed to fetch", "TypeError")
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/Не удалось выполнить запрос/)
    })

    it("обрабатывает таймаут с русским сообщением", async () => {
      const fetch = mockFetchError("Aborted", "AbortError")
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await expect(client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })).rejects.toThrowError(/Превышен таймаут/)
    })
  })

  describe("generate", () => {
    it("делегирует в chat и возвращает ответ", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "генерация" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      const result = await client.generate({
        prompt: "сгенерируй",
        model: "yandexgpt/latest",
        url: "",
      })

      expect(result).toBe("генерация")
      const callBody = JSON.parse(mockCalls(fetch)[0][1].body as string)
      expect(callBody.messages[0].content).toBe("сгенерируй")
    })
  })

  describe("getEmbeddings", () => {
    it("выбрасывает ошибку о несовместимости", async () => {
      const client = new YandexGPTClient(API_KEY, FOLDER_ID)

      await expect(client.getEmbeddings({
        input: ["test"],
        model: "yandexgpt/latest",
        url: "",
      })).rejects.toThrowError(/не поддерживает генерацию эмбеддингов/)
    })
  })

  describe("listModels", () => {
    it("возвращает известные модели", async () => {
      const client = new YandexGPTClient(API_KEY, FOLDER_ID)

      const models = await client.listModels("")

      expect(models).toEqual(["yandexgpt/latest", "yandexgpt-pro/latest", "yandexgpt-lite/latest"])
    })
  })

  describe("buildModelUri", () => {
    it("добавляет folder ID к модели", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })

      const callBody = JSON.parse(mockCalls(fetch)[0][1].body as string)
      expect(callBody.model).toBe("gpt://b1gtestfolder/yandexgpt/latest")
    })

    it("не добавляет folder ID если модель уже содержит gpt://", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await client.chat({
        model: "gpt://custom-folder/custom-model",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })

      const callBody = JSON.parse(mockCalls(fetch)[0][1].body as string)
      expect(callBody.model).toBe("gpt://custom-folder/custom-model")
    })

    it("не добавляет folder ID если модель содержит ds://", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, undefined, fetch)

      await client.chat({
        model: "ds://custom-model",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })

      const callBody = JSON.parse(mockCalls(fetch)[0][1].body as string)
      expect(callBody.model).toBe("ds://custom-model")
    })
  })

  describe("конструктор с кастомным baseUrl", () => {
    it("использует переданный baseUrl", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] })
      const client = new YandexGPTClient(API_KEY, FOLDER_ID, "https://custom.url/v1", fetch)

      await client.chat({
        model: "yandexgpt/latest",
        url: "",
        messages: [{ role: "user", content: "test" }],
      })

      expect(mockCalls(fetch)[0][0]).toBe("https://custom.url/v1/chat/completions")
    })
  })
})
