import { describe, it, expect, vi, beforeEach } from "vitest"
import { KnowledgeGraph } from "../../../src/services/graph/knowledge-graph"
import { QueryEngine } from "../../../src/services/graph/query-engine"
import { OllamaClient } from "../../../src/types"

describe("QueryEngine", () => {
  let graph: KnowledgeGraph
  let ollama: OllamaClient

  beforeEach(() => {
    graph = new KnowledgeGraph("/test/manifest.json")

    graph.addEntity({
      id: "mat-001", name: "Сплав-X", type: "material", aliases: ["Alloy X"],
      properties: {}, tags: ["никель"], source: "doc.pdf",
      context: "сплав X используется в турбинах",
      createdAt: "", updatedAt: "",
    })
    graph.addEntity({
      id: "exp-001", name: "Эксперимент-1", type: "experiment", aliases: [],
      properties: { temperature: "800°C", result: "+12%" }, tags: [],
      source: "doc.pdf",
      context: "эксперимент показал увеличение прочности на 12%",
      createdAt: "", updatedAt: "",
    })
    graph.addRelation({ from: "exp-001", to: "mat-001", type: "uses_material", context: "использован сплав X" })
  })

  describe("answerQuestion", () => {
    it("returns answer with context for found entities", async () => {
      ollama = {
        generate: vi.fn(),
        chat: vi.fn()
          .mockResolvedValueOnce('["Сплав-X"]')           // extractEntities
          .mockResolvedValueOnce("[[Сплав-X]] использован в [[Эксперимент-1]]"), // generateAnswer
        listModels: vi.fn(),
      }

      const engine = new QueryEngine(graph, ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })

      const result = await engine.answerQuestion("Что делали со сплавом X?")

      expect(result.answer).toBeTruthy()
      expect(result.contextMd).toContain("[[Сплав-X]]")
      expect(result.linkedDocs.length).toBeGreaterThan(0)
    })

    it("handles no results gracefully", async () => {
      ollama = {
        generate: vi.fn(),
        chat: vi.fn()
          .mockResolvedValueOnce('["Unknown"]')           // extractEntities
          .mockResolvedValueOnce("Нет информации"),        // generateAnswer
        listModels: vi.fn(),
      }

      const engine = new QueryEngine(graph, ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })

      const result = await engine.answerQuestion("Что делали со сплавом Unknown?")
      expect(result.answer).toBeTruthy()
      expect(result.contextMd).toContain("В графе нет информации")
    })

    it("works with partially matching query", async () => {
      ollama = {
        generate: vi.fn(),
        chat: vi.fn()
          .mockResolvedValueOnce('["Сплав-X"]')           // extractEntities
          .mockResolvedValueOnce("[[Эксперимент-1]] при 800°C"), // generateAnswer
        listModels: vi.fn(),
      }

      const engine = new QueryEngine(graph, ollama, { model: "gemma4:e4b", url: "http://localhost:11434" })

      const result = await engine.answerQuestion("Какая температура?")
      expect(result.answer).toBeTruthy()
    })
  })
})
