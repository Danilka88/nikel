import { describe, it, expect, vi } from "vitest"
import { EntityExtractor, normalizeName, dedupEntities } from "../../../src/services/ingestion/entity-extractor"
import { Entity, ExtractionResult, OllamaClient } from "../../../src/types"

function mockOllama(response: string): OllamaClient {
  return {
    generate: vi.fn(),
    chat: vi.fn().mockResolvedValue(response),
    listModels: vi.fn(),
  }
}

describe("EntityExtractor", () => {
  describe("extract", () => {
    it("extracts entities and relations from markdown", async () => {
      const ollama = mockOllama(JSON.stringify({
        entities: [
          { id: "mat-001", name: "Сплав-X", type: "material", aliases: ["Alloy X"], properties: {}, context: "сплав X используется" },
          { id: "exp-001", name: "Эксперимент-1", type: "experiment", aliases: [], properties: {}, context: "эксперимент показал" },
        ],
        relations: [
          { from: "exp-001", to: "mat-001", type: "uses_material", context: "использовался сплав X" },
        ],
      }))

      const extractor = new EntityExtractor(ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })
      const result = await extractor.extract("# Документ\nсплав X", "/path/doc.pdf")

      expect(result.entities).toHaveLength(2)
      expect(result.relations).toHaveLength(1)
      expect(result.entities[0].name).toBe("Сплав-X")
      expect(result.entities[0].source).toBe("/path/doc.pdf")
    })

    it("retries on invalid JSON and throws after max retries", async () => {
      const ollama = mockOllama("невалидный ответ")
      const extractor = new EntityExtractor(ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })

      await expect(extractor.extract("text", "/path/doc.pdf")).rejects.toThrow()
      expect(ollama.chat).toHaveBeenCalledTimes(2)
    })

    it("handles empty entities and relations", async () => {
      const ollama = mockOllama(JSON.stringify({ entities: [], relations: [] }))
      const extractor = new EntityExtractor(ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })

      const result = await extractor.extract("text", "/path/doc.pdf")
      expect(result.entities).toHaveLength(0)
      expect(result.relations).toHaveLength(0)
    })
  })

  describe("normalizeName", () => {
    it("lowercases and replaces spaces with hyphens", () => {
      expect(normalizeName("Сплав X")).toBe("сплав-x")
    })

    it("removes special characters", () => {
      expect(normalizeName("Сплав-X (легированный)!")).toBe("сплав-x-легированный")
    })

    it("handles empty string", () => {
      expect(normalizeName("")).toBe("")
    })
  })

  describe("dedupEntities", () => {
    it("merges entities with same type and normalized name", () => {
      const entities: Entity[] = [
        {
          id: "1", name: "Сплав-X", type: "material", aliases: [], properties: { key: "val1" },
          tags: [], source: "a.pdf", context: "контекст 1", createdAt: "", updatedAt: "",
        },
        {
          id: "2", name: "Сплав X", type: "material", aliases: [], properties: { key: "val2" },
          tags: [], source: "b.pdf", context: "контекст 2", createdAt: "", updatedAt: "",
        },
      ]

      const result = dedupEntities(entities)
      expect(result).toHaveLength(1)
      expect(result[0].aliases).toContain("Сплав-X")
      expect(result[0].aliases).toContain("Сплав X")
      expect(result[0].properties.key).toBe("val2")
      expect(result[0].tags).toHaveLength(0)
    })

    it("returns unique entities unchanged", () => {
      const entities: Entity[] = [
        {
          id: "1", name: "Сплав-X", type: "material", aliases: [], properties: {},
          tags: [], source: "", createdAt: "", updatedAt: "",
        },
        {
          id: "2", name: "Режим-Y", type: "mode", aliases: [], properties: {},
          tags: [], source: "", createdAt: "", updatedAt: "",
        },
      ]

      const result = dedupEntities(entities)
      expect(result).toHaveLength(2)
    })

    it("handles empty array", () => {
      expect(dedupEntities([])).toHaveLength(0)
    })
  })
})
