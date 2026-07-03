import type { Entity, IndexingMode } from "./types"

export function resolvePdfMode(mode: IndexingMode): "vision" | "fast" {
  return mode === "direct" ? "fast" : mode
}

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
  publication: "publications",
  process: "processes",
  facility: "facilities",
}

const DEFAULT_DIR = "other"

export function getSubDir(type: string): string {
  return TYPE_DIR_MAP[type] || DEFAULT_DIR
}

export function safeFileName(name: string): string {
  const result = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return result || "unnamed"
}

const SOURCE_FOLDER_MAP: Record<string, NonNullable<Entity["sourceType"]>> = {
  "доклады": "report",
  "доклад": "report",
  "журналы": "article",
  "журнал": "article",
  "материалы конференций": "conference",
  "конференция": "conference",
  "конференции": "conference",
  "обзоры": "review",
  "обзор": "review",
  "статьи": "article",
  "статья": "article",
  "патенты": "patent",
  "патент": "patent",
  "диссертации": "dissertation",
  "диссертация": "dissertation",
}

export function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function detectSourceType(relPath: string): Entity["sourceType"] {
  const parts = relPath.split("/")
  for (const part of parts) {
    const key = part.toLowerCase().trim()
    const mapped = SOURCE_FOLDER_MAP[key]
    if (mapped) return mapped
  }
  return "other"
}
