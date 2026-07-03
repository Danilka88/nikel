import { describe, it, expect } from "vitest"
import { MdGenerator } from "../../../src/services/generation/md-generator"
import { Entity, Relation } from "../../../src/types"

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "mat-001",
    name: "Сплав-X",
    type: "material",
    aliases: [],
    properties: {},
    tags: ["никель"],
    source: "doc.pdf",
    sourcePage: 5,
    context: "Сплав X — никелевый жаропрочный сплав",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  }
}

describe("MdGenerator", () => {
  const generator = new MdGenerator("nikel")

  describe("generateDoc", () => {
    it("generates frontmatter with id, type, name, tags", () => {
      const entity = makeEntity()
      const result = generator.generateDoc(entity, [])

      expect(result.content).toContain("---")
      expect(result.content).toContain("id: mat-001")
      expect(result.content).toContain("type: material")
      expect(result.content).toContain("name: Сплав-X")
      expect(result.content).toContain("никель")
    })

    it("includes [[links]] for related entities", () => {
      const entity = makeEntity()
      const relations: Relation[] = [
        { from: "exp-001", to: "mat-001", type: "uses_material", context: "использован" },
      ]
      const result = generator.generateDoc(entity, relations)

      expect(result.content).toContain("[[exp-001]]")
    })

    it("includes properties section when present", () => {
      const entity = makeEntity({ properties: { Прочность: "450 МПа", Твёрдость: "320 HV" } })
      const result = generator.generateDoc(entity, [])

      expect(result.content).toContain("450 МПа")
      expect(result.content).toContain("320 HV")
    })

    it("wraps source page number", () => {
      const entity = makeEntity()
      const result = generator.generateDoc(entity, [])

      expect(result.content).toContain("стр. 5")
    })

    it("handles entity without context", () => {
      const entity = makeEntity({ context: undefined })
      const result = generator.generateDoc(entity, [])

      expect(result.content).toContain("## Сплав-X")
    })
  })

  describe("generateAnswerDoc", () => {
    it("generates answer document with frontmatter and sources", () => {
      const result = generator.generateAnswerDoc(
        { answer: "Ответ", contextMd: "Контекст", linkedDocs: ["nikel/experiments/exp-001.md"] },
        "Вопрос про сплав X",
        "gemma4:e4b",
      )

      expect(result.content).toContain("type: answer")
      expect(result.content).toContain("Вопрос про сплав X")
      expect(result.content).toContain("[[nikel/experiments/exp-001.md]]")
      expect(result.content).toContain("Ответ")
    })
  })
})
