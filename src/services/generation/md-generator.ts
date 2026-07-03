import * as path from "path"
import { DocContent, Entity, QueryResult, Relation } from "../../types"
import { getSubDir, safeFileName as safeName } from "../../utils"

export class MdGenerator {
  constructor(
    private _nikelDir: string,
  ) {}

  generateDoc(entity: Entity, relations: Relation[]): DocContent {
    const subDir = getSubDir(entity.type)
    const safeNameStr = safeName(entity.name)
    const docPath = path.join(this._nikelDir, subDir, `${safeNameStr}.md`)

    const tags = this.buildTags(entity)
    const dataviewFields = this.buildDataview(entity, relations)

    const frontmatter: Record<string, unknown> = {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      tags,
      ...dataviewFields,
    }

    if (entity.aliases.length > 0) {
      frontmatter.aliases = entity.aliases
    }

    if (entity.confidence) frontmatter.confidence = entity.confidence
    if (entity.geography) frontmatter.geography = entity.geography
    if (entity.year !== undefined) frontmatter.year = entity.year
    if (entity.sourceType) frontmatter.sourceType = entity.sourceType

    const relatedEntities = relations
      .filter((r) => r.from === entity.id || r.to === entity.id)
      .map((r) => {
        const targetId = r.from === entity.id ? r.to : r.from
        return `[[${targetId}]]${r.context ? ` — ${r.context}` : ""}`
      })

    const bodyParts: string[] = [
      `## ${entity.name}`,
    ]

    if (entity.context) {
      bodyParts.push("", entity.context)
    }

    if (entity.properties && Object.keys(entity.properties).length > 0) {
      bodyParts.push("", "### Свойства")
      for (const [key, val] of Object.entries(entity.properties)) {
        bodyParts.push(`- **${key}:** ${val}`)
      }
    }

    if (relatedEntities.length > 0) {
      bodyParts.push("", "### Связанные сущности")
      bodyParts.push(...relatedEntities)
    }

    if (entity.source) {
      bodyParts.push("", "### Источник", `[[${path.basename(entity.source)}]]${entity.sourcePage ? ` (стр. ${entity.sourcePage})` : ""}`)
    }

    const content = this.buildFrontmatter(frontmatter) + "\n" + bodyParts.join("\n") + "\n"

    return { path: docPath, content, frontmatter }
  }

  generateAnswerDoc(result: QueryResult, question: string, modelName: string): DocContent {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const docPath = path.join(this._nikelDir, "_answers", `${timestamp}.md`)

    const frontmatter: Record<string, unknown> = {
      type: "answer",
      question,
      sources: result.linkedDocs,
      model: modelName,
      created: now.toISOString(),
    }

    const bodyParts: string[] = [
      `## Ответ на: ${question}`,
      "",
      result.answer,
    ]

    if (result.contextMd) {
      bodyParts.push("", "### Контекст из базы знаний", "", result.contextMd)
    }

    if (result.linkedDocs.length > 0) {
      bodyParts.push("", "### Источники")
      bodyParts.push(...result.linkedDocs.map((d) => `- [[${d}]]`))
    }

    const content = this.buildFrontmatter(frontmatter) + "\n" + bodyParts.join("\n") + "\n"

    return { path: docPath, content, frontmatter }
  }

  private buildFrontmatter(fields: Record<string, unknown>): string {
    const lines = ["---"]
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || val === null) continue
      if (Array.isArray(val)) {
        if (val.length === 0) continue
        lines.push(`${key}: [${val.map((v) => String(v).includes(" ") ? `"${v}"` : v).join(", ")}]`)
      } else if (typeof val === "string") {
        if (val.includes(":") || val.includes("#") || val.includes("\n")) {
          lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`)
        } else if (val.includes("[[") || val.includes("]]")) {
          lines.push(`${key}: "${val}"`)
        } else {
          lines.push(`${key}: ${val}`)
        }
      } else if (typeof val === "object") {
        const inner = Object.entries(val as Record<string, unknown>)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")
        lines.push(`${key}:`)
        lines.push(inner)
      } else {
        lines.push(`${key}: ${val}`)
      }
    }
    lines.push("---")
    return lines.join("\n")
  }

  private buildTags(entity: Entity): string[] {
    const tags = [...entity.tags]
    if (!tags.includes(entity.type)) {
      tags.unshift(entity.type)
    }
    return tags
  }

  private buildDataview(entity: Entity, relations: Relation[]): Record<string, unknown> {
    const fields: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(entity.properties)) {
      fields[key] = val
    }

    const relFieldMap: Record<string, string> = {
      uses_material: "material",
      has_property: "property",
      in_mode: "mode",
      uses_equipment: "equipment",
      conducted_by: "team",
      leads_to: "conclusion",
      related_to: "related",
      precedes: "precedes",
      described_in: "source",
      operates_at_condition: "condition",
      produces_output: "output",
      validated_by: "validated",
      contradicts: "contradicts",
    }

    for (const rel of relations) {
      const fieldName = relFieldMap[rel.type]
      if (!fieldName) continue
      const targetId = rel.from === entity.id ? rel.to : rel.from
      if (!fields[fieldName]) {
        fields[fieldName] = []
      }
      ;(fields[fieldName] as string[]).push(`[[${targetId}]]`)
    }

    for (const [key, val] of Object.entries(fields)) {
      if (Array.isArray(val)) {
        fields[key] = [...new Set(val)]
      }
    }

    return fields
  }

}
