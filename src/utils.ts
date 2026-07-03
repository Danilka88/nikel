import type { Entity, IndexingMode } from "./types"

const CHUNK_MAX_LEN = 1000
const CHUNK_OVERLAP = 200

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

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function bm25(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
  docLen: number,
  getDocFreq: (term: string) => number,
  totalDocs: number,
  k1 = 1.5,
  b = 0.75,
): number {
  let score = 0
  const idf = (n: number, N: number) => Math.log(1 + (N - n + 0.5) / (n + 0.5))
  const termFreqs = new Map<string, number>()
  for (const t of docTerms) termFreqs.set(t, (termFreqs.get(t) || 0) + 1)

  for (const term of queryTerms) {
    const tf = termFreqs.get(term) || 0
    if (tf === 0) continue
    const df = getDocFreq(term)
    const idfVal = idf(df, totalDocs)
    score += idfVal * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))))
  }
  return score
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-zа-яё0-9]+/).filter(Boolean)
}

export function semanticChunk(text: string): string[] {
  if (!text) return []

  const paragraphs = text.split(/\n\n+/).filter(Boolean)
  const chunks: string[] = []
  let current = ""

  for (const p of paragraphs) {
    if (current.length + p.length + 2 > CHUNK_MAX_LEN && current.length > 0) {
      chunks.push(current.trim())
      current = ""
    }
    if (p.length > CHUNK_MAX_LEN) {
      if (current) {
        chunks.push(current.trim())
        current = ""
      }
      let start = 0
      while (start < p.length) {
        const end = Math.min(start + CHUNK_MAX_LEN, p.length)
        chunks.push(p.slice(start, end).trim())
        if (end === p.length) break
        start = end - CHUNK_OVERLAP
      }
      continue
    }
    current += (current ? "\n\n" : "") + p
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
