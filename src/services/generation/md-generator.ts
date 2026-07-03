import * as path from "path"
import { DocContent, Entity, QueryResult, Relation } from "../../types"

const TYPE_DIR_MAP: Record<string, string> = {
  material: "materials",
  experiment: "experiments",
  property: "properties",
  mode: "modes",
  equipment: "equipment",
  team: "teams",
  person: "persons",
  conclusion: "conclusions",
  topic: "topics",
}

const DEFAULT_DIR = "other"

export class MdGenerator {
  constructor(
    private _nikelDir: string,
  ) {}

  generateDoc(entity: Entity, relations: Relation[]): DocContent {
    const subDir = TYPE_DIR_MAP[entity.type] || DEFAULT_DIR
    const safeName = this.safeFileName(entity.name)
    const docPath = path.join(this._nikelDir, subDir, `${safeName}.md`)

    const tags = this.buildTags(entity)
    const dataviewFields = this.buildDataview(entity)

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

    const relatedExperiments = relations
      .filter((r) => r.type === "uses_material" || r.type === "related_to" || r.type === "precedes")
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

    if (relatedExperiments.length > 0) {
      bodyParts.push("", "### Связанные сущности")
      bodyParts.push(...relatedExperiments.map((l) => `- ${l}`))
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

  private buildDataview(entity: Entity): Record<string, unknown> {
    const fields: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(entity.properties)) {
      fields[key] = val
    }
    return fields
  }

  private safeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  }
}
