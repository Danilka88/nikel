import { describe, it, expect } from "vitest"
import { IndexGenerator } from "../../../src/services/generation/index-generator"
import { IndexManifest } from "../../../src/types"

describe("IndexGenerator", () => {
  const generator = new IndexGenerator()

  const manifest: IndexManifest = {
    version: 1,
    lastIndexed: "2024-06-15T10:00:00.000Z",
    files: { "doc1.pdf": "abc", "doc2.pdf": "def" },
    entities: [
      {
        id: "mat-001", name: "Сплав-X", type: "material", aliases: [],
        properties: {}, tags: ["никель", "жаропрочный"],
        source: "doc1.pdf", createdAt: "", updatedAt: "",
      },
      {
        id: "exp-001", name: "Эксперимент-1", type: "experiment", aliases: [],
        properties: {}, tags: ["испытание"],
        source: "doc1.pdf", createdAt: "", updatedAt: "",
      },
      {
        id: "prop-001", name: "Прочность", type: "property", aliases: [],
        properties: {}, tags: ["механика"],
        source: "doc2.pdf", createdAt: "", updatedAt: "",
      },
    ],
    relations: [
      { from: "exp-001", to: "mat-001", type: "uses_material" },
      { from: "exp-001", to: "prop-001", type: "has_property" },
    ],
  }

  describe("generateIndex", () => {
    it("generates index with category sections", () => {
      const result = generator.generateIndex(manifest)

      expect(result).toContain("Материалы (1)")
      expect(result).toContain("Эксперименты (1)")
      expect(result).toContain("Свойства (1)")
      expect(result).toContain("[[nikel/materials/Сплав-X]]")
      expect(result).toContain("#никель")
    })

    it("includes statistics in frontmatter", () => {
      const result = generator.generateIndex(manifest)

      expect(result).toContain("type: index")
      expect(result).toContain("entities: 3")
      expect(result).toContain("sources: 2")
    })
  })

  describe("generateGraphMermaid", () => {
    it("generates mermaid graph with relations", () => {
      const result = generator.generateGraphMermaid(manifest)

      expect(result).toContain("```mermaid")
      expect(result).toContain("graph LR")
      expect(result).toContain("uses material")
    })

    it("includes legend", () => {
      const result = generator.generateGraphMermaid(manifest)

      expect(result).toContain("### Легенда узлов")
      expect(result).toContain("materials/")
    })

    it("handles empty manifest", () => {
      const empty: IndexManifest = {
        version: 1, lastIndexed: "", files: {}, entities: [], relations: [],
      }
      const result = generator.generateGraphMermaid(empty)

      expect(result).toContain("mermaid")
    })
  })
})
