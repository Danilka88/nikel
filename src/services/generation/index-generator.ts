import { Entity, IndexManifest } from "../../types"

const TYPE_LABELS: Record<string, string> = {
  material: "Материалы",
  experiment: "Эксперименты",
  property: "Свойства",
  mode: "Режимы",
  equipment: "Оборудование",
  team: "Команды",
  person: "Исследователи",
  conclusion: "Выводы",
  topic: "Темы",
}

const ENTITY_TYPES = [
  "material", "experiment", "property", "mode",
  "equipment", "team", "person", "conclusion", "topic",
] as const

export class IndexGenerator {
  generateIndex(manifest: IndexManifest): string {
    const lines: string[] = [
      "---",
      "type: index",
      "description: Автоматически сгенерированный каталог базы знаний",
      `updated: ${manifest.lastIndexed}`,
      `entities: ${manifest.entities.length}`,
      `relations: ${manifest.relations.length}`,
      `sources: ${Object.keys(manifest.files).length}`,
      "---",
      "",
      "# База знаний Nikel",
      "",
      `*Обновлено: ${new Date(manifest.lastIndexed).toLocaleString("ru-RU")}*`,
      "",
      "## Статистика",
      "",
      `- **Сущности:** ${manifest.entities.length}`,
      `- **Связи:** ${manifest.relations.length}`,
      `- **Источники:** ${Object.keys(manifest.files).length} PDF`,
      "",
      "---",
      "",
    ]

    for (const type of ENTITY_TYPES) {
      const entities = manifest.entities.filter((e) => e.type === type)
      if (entities.length === 0) continue

      const label = TYPE_LABELS[type] || type
      lines.push(`## ${label} (${entities.length})`)
      lines.push("")

      const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name))
      for (const entity of sorted) {
        const link = `[[nikel/${this.getSubDir(type)}/${this.safeFileName(entity.name)}]]`
        const tags = entity.tags.map((t) => `#${t}`).join(" ")
        lines.push(`- ${link} ${tags}`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  generateGraphMermaid(manifest: IndexManifest): string {
    const lines: string[] = [
      "---",
      "type: graph",
      "description: Mermaid-диаграмма связей базы знаний",
      `updated: ${manifest.lastIndexed}`,
      "---",
      "",
      "# Граф знаний",
      "",
      "```mermaid",
      "graph LR",
    ]

    const added = new Set<string>()

    for (const rel of manifest.relations) {
      const key = `${rel.from}|${rel.to}|${rel.type}`
      if (added.has(key)) continue
      added.add(key)

      const fromName = this.toMermaidId(rel.from)
      const toName = this.toMermaidId(rel.to)
      const label = rel.type.replace(/_/g, " ")
      lines.push(`  ${fromName} -->|"${label}"| ${toName}`)
    }

    lines.push("```")

    if (manifest.entities.length > 0) {
      lines.push("", "### Легенда узлов")
      lines.push("")
      for (const type of ENTITY_TYPES) {
        const label = TYPE_LABELS[type] || type
        lines.push(`- \`${this.getSubDir(type)}/\` — ${label}`)
      }
    }

    return lines.join("\n")
  }

  private getSubDir(type: string): string {
    const map: Record<string, string> = {
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
    return map[type] || "other"
  }

  private safeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  }

  private toMermaidId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, "_")
  }
}
