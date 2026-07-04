import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"
import { KnowledgeGraph } from "../../../src/services/graph/knowledge-graph"
import { Entity, Relation, IndexManifest } from "../../../src/types"
import { createEmptyManifest } from "../../../src/utils"

vi.mock("fs/promises")

function makeEntity(id: string, name: string, type: string = "material"): Entity {
  return {
    id, name, type: type as any, aliases: [], properties: {}, tags: [],
    source: "test.pdf", createdAt: "2024-01-01", updatedAt: "2024-01-01",
  }
}

function makeRelation(from: string, to: string, type: string = "related_to"): Relation {
  return { from, to, type: type as any }
}

describe("KnowledgeGraph", () => {
  let graph: KnowledgeGraph
  const manifestPath = "/test/.nikel/index.json"

  beforeEach(() => {
    vi.clearAllMocks()
    graph = new KnowledgeGraph(manifestPath)
  })

  describe("load", () => {
    it("loads existing manifest from file", async () => {
      const data: IndexManifest = {
        version: 1, lastIndexed: "2024-01-01",
        files: {}, entities: [makeEntity("1", "Test")], relations: [],
      }
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(data))

      await graph.load()
      expect(graph.entities).toHaveLength(1)
      expect(graph.entities[0].name).toBe("Test")
    })

    it("creates empty manifest if file does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("not found"))
      await graph.load()
      expect(graph.entities).toHaveLength(0)
      expect(graph.relations).toHaveLength(0)
    })
  })

  describe("save", () => {
    it("writes atomically: tmp then rename", async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined)
      vi.mocked(fs.rename).mockResolvedValueOnce(undefined)

      await graph.save()

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.any(String),
        "utf-8",
      )
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        manifestPath,
      )
    })
  })

  describe("CRUD", () => {
    it("adds and retrieves entity by id", () => {
      graph.addEntity(makeEntity("e1", "Сплав-X"))
      expect(graph.getEntity("e1")?.name).toBe("Сплав-X")
    })

    it("returns undefined for unknown id", () => {
      expect(graph.getEntity("unknown")).toBeUndefined()
    })

    it("finds entity by name", () => {
      graph.addEntity(makeEntity("e1", "Сплав-X"))
      const found = graph.getEntityByName("Сплав-X")
      expect(found?.id).toBe("e1")
    })

    it("finds entity by alias", () => {
      const entity = makeEntity("e1", "Сплав-X")
      entity.aliases = ["Alloy X"]
      graph.addEntity(entity)
      const found = graph.getEntityByName("Alloy X")
      expect(found?.id).toBe("e1")
    })

    it("adds and retrieves relations", () => {
      graph.addEntity(makeEntity("e1", "A"))
      graph.addEntity(makeEntity("e2", "B"))
      graph.addRelation(makeRelation("e1", "e2"))

      const related = graph.findRelated("e1")
      expect(related).toHaveLength(1)
      expect(related[0].to).toBe("e2")
    })
  })

  describe("findEntities", () => {
    beforeEach(() => {
      graph.addEntity(makeEntity("e1", "Сплав-X", "material"))
      graph.addEntity(makeEntity("e2", "Режим-Y", "mode"))
      graph.addEntity(makeEntity("e3", "Сплав-Z", "material"))
    })

    it("filters by type", () => {
      const result = graph.findEntities("material")
      expect(result).toHaveLength(2)
    })

    it("searches by query substring", () => {
      const result = graph.findEntities(undefined, "сплав")
      expect(result).toHaveLength(2)
    })

    it("returns all entities when no filters", () => {
      const result = graph.findEntities()
      expect(result).toHaveLength(3)
    })
  })

  describe("search", () => {
    it("finds entities matching text in name, aliases, tags, context", () => {
      const entity = makeEntity("e1", "Сплав-X", "material")
      entity.tags = ["никель", "турбина"]
      entity.context = "высокотемпературный сплав"
      graph.addEntity(entity)

      const byTag = graph.search("турбина")
      expect(byTag.entities).toHaveLength(1)

      const byContext = graph.search("высокотемпературный")
      expect(byContext.entities).toHaveLength(1)
    })
  })

  describe("mergeIndex", () => {
    it("merges new entities and relations", () => {
      graph.addEntity(makeEntity("e1", "Existing", "material"))

      const incoming: IndexManifest = {
        version: 1, lastIndexed: "2024-01-01", files: {},
        entities: [makeEntity("e2", "New", "experiment")],
        relations: [makeRelation("e1", "e2")],
      }

      graph.mergeIndex(incoming)
      expect(graph.entities).toHaveLength(2)
      expect(graph.relations).toHaveLength(1)
    })

    it("deduplicates by type + name", () => {
      graph.addEntity(makeEntity("e1", "Сплав-X", "material"))

      const incoming: IndexManifest = {
        version: 1, lastIndexed: "2024-01-01", files: {},
        entities: [makeEntity("e2", "Сплав X", "material")],
        relations: [],
      }

      graph.mergeIndex(incoming)
      expect(graph.entities).toHaveLength(1)
    })

    it("does not duplicate identical relations", () => {
      graph.addEntity(makeEntity("e1", "A"))
      graph.addEntity(makeEntity("e2", "B"))
      graph.addRelation(makeRelation("e1", "e2", "related_to"))

      const incoming: IndexManifest = {
        version: 1, lastIndexed: "2024-01-01", files: {},
        entities: [],
        relations: [makeRelation("e1", "e2", "related_to")],
      }

      graph.mergeIndex(incoming)
      expect(graph.relations).toHaveLength(1)
    })
  })

  describe("buildCluster", () => {
    it("returns entity and its direct relations at depth 1", () => {
      graph.addEntity(makeEntity("center", "Center"))
      graph.addEntity(makeEntity("a", "A"))
      graph.addEntity(makeEntity("b", "B"))
      graph.addRelation(makeRelation("center", "a", "related_to"))
      graph.addRelation(makeRelation("center", "b", "uses_material"))

      const cluster = graph.buildCluster("center")

      expect(cluster.entities).toHaveLength(3)
      expect(cluster.relations).toHaveLength(2)
    })
  })

  describe("searchFiltered", () => {
    beforeEach(() => {
      const e1 = makeEntity("e1", "Сплав-X", "material")
      e1.geography = "ru"
      e1.year = 2023
      e1.confidence = "high"
      e1.properties = { "Концентрация (мг/л)": "150" }
      graph.addEntity(e1)
      graph.addEntity(makeEntity("e2", "Сплав-Y", "material"))
      const e3 = makeEntity("e3", "Эксперимент при 800°C", "experiment")
      e3.geography = "foreign"
      e3.year = 2024
      graph.addEntity(e3)
    })

    it("filters by geography", () => {
      const result = graph.searchFiltered({ geography: "ru" })
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe("Сплав-X")
    })

    it("filters by year range", () => {
      const result = graph.searchFiltered({ yearMin: 2024 })
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe("Эксперимент при 800°C")
    })

    it("filters by confidence", () => {
      const result = graph.searchFiltered({ confidence: "high" })
      expect(result.entities).toHaveLength(1)
    })

    it("filters by numeric param", () => {
      const result = graph.searchFiltered({ numericParams: [{ name: "Концентрация (мг/л)", operator: "lt", value: 200 }] })
      expect(result.entities).toHaveLength(1)
    })

    it("filters by entity type", () => {
      const result = graph.searchFiltered({ types: ["material"] })
      expect(result.entities).toHaveLength(2)
    })

    it("returns empty when no match", () => {
      const result = graph.searchFiltered({ geography: "both" })
      expect(result.entities).toHaveLength(0)
    })
  })

  describe("getStats", () => {
    it("returns correct counts", () => {
      graph.addEntity(makeEntity("e1", "A", "material"))
      graph.addEntity(makeEntity("e2", "B", "experiment"))
      graph.addRelation(makeRelation("e1", "e2"))

      const stats = graph.getStats()
      expect(stats.entityCount).toBe(2)
      expect(stats.relationCount).toBe(1)
      expect(stats.fileCount).toBe(1)
    })
  })
})
