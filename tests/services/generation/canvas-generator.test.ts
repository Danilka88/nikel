import { describe, it, expect, beforeEach } from "vitest"
import { CanvasGenerator } from "../../../src/services/generation/canvas-generator"
import { KnowledgeGraph } from "../../../src/services/graph/knowledge-graph"
import { Entity } from "../../../src/types"

function makeEntity(id: string, name: string, type: string): Entity {
  return {
    id, name, type: type as any, aliases: [], properties: {}, tags: [],
    source: "doc.pdf", createdAt: "", updatedAt: "",
  }
}

describe("CanvasGenerator", () => {
  let graph: KnowledgeGraph
  let generator: CanvasGenerator

  beforeEach(() => {
    graph = new KnowledgeGraph("/test/manifest.json")
    generator = new CanvasGenerator("nikel")
  })

  describe("generateCluster", () => {
    it("generates radial layout for a cluster", () => {
      graph.addEntity(makeEntity("center", "Центр", "material"))
      graph.addEntity(makeEntity("a", "Связанный", "experiment"))
      graph.addRelation({ from: "center", to: "a", type: "related_to" })

      const canvas = generator.generateCluster("center", graph)

      expect(canvas.nodes.length).toBeGreaterThanOrEqual(2)
      expect(canvas.edges.length).toBeGreaterThanOrEqual(1)
      expect(canvas.path).toContain(".canvas")
    })

    it("handles single entity with no relations", () => {
      graph.addEntity(makeEntity("alone", "Один", "material"))

      const canvas = generator.generateCluster("alone", graph)

      expect(canvas.nodes).toHaveLength(1)
      expect(canvas.edges).toHaveLength(0)
    })
  })

  describe("generateGlobalOverview", () => {
    it("generates overview with grid layout", () => {
      graph.addEntity(makeEntity("a", "A", "material"))
      graph.addEntity(makeEntity("b", "B", "experiment"))
      graph.addRelation({ from: "a", to: "b", type: "related_to" })

      const canvas = generator.generateGlobalOverview(graph)

      expect(canvas.nodes).toHaveLength(2)
      expect(canvas.edges).toHaveLength(1)
    })

    it("caps at MAX_NODES_OVERVIEW=50", () => {
      for (let i = 0; i < 60; i++) {
        graph.addEntity(makeEntity(`e${i}`, `Entity-${i}`, "topic"))
      }

      const canvas = generator.generateGlobalOverview(graph)
      expect(canvas.nodes.length).toBeLessThanOrEqual(50)
    })
  })

  describe("generateTimeline", () => {
    it("generates timeline for experiments sorted by date", () => {
      graph.addEntity(makeEntity("e1", "Первый", "experiment"))
      graph.addEntity(makeEntity("e2", "Второй", "experiment"))
      graph.addEntity(makeEntity("m1", "Не эксперимент", "material"))

      const canvas = generator.generateTimeline(graph.entities, graph.relations)

      expect(canvas.nodes).toHaveLength(2)
    })

    it("returns empty canvas for no experiments", () => {
      graph.addEntity(makeEntity("m1", "Только материал", "material"))

      const canvas = generator.generateTimeline(graph.entities, graph.relations)

      expect(canvas.nodes).toHaveLength(0)
    })
  })
})
