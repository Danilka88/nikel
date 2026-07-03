import * as path from "path"
import * as fs from "fs/promises"
import type { TextChunk } from "../../types"

const CHUNK_MAX_LEN = 1000
const CHUNK_OVERLAP = 200

export class DocumentStore {
  private chunks: TextChunk[] = []
  private filePath: string

  constructor(nikelDir: string) {
    this.filePath = path.join(nikelDir, ".nikel", "document-store.json")
  }

  addDocument(sourcePath: string, text: string, pageNum?: number): void {
    const chunks = this.chunkText(text)
    for (let i = 0; i < chunks.length; i++) {
      this.chunks.push({
        sourcePath,
        pageNum: pageNum ?? 1,
        chunkIndex: i,
        text: chunks[i],
      })
    }
  }

  removeBySource(sourcePath: string): void {
    this.chunks = this.chunks.filter((c) => c.sourcePath !== sourcePath)
  }

  search(query: string, topK = 5): TextChunk[] {
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (queryWords.length === 0) return []

    const scored = this.chunks.map((chunk) => {
      const textLower = chunk.text.toLowerCase()
      const matchCount = queryWords.filter((w) => textLower.includes(w)).length
      return { chunk, score: matchCount }
    })

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.chunk)
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const data = JSON.stringify(this.chunks, null, 2)
    const tmp = this.filePath + ".tmp"
    await fs.writeFile(tmp, data, "utf-8")
    await fs.rename(tmp, this.filePath)
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, "utf-8")
      this.chunks = JSON.parse(data) as TextChunk[]
    } catch {
      this.chunks = []
    }
  }

  clear(): void {
    this.chunks = []
  }

  get stats(): { totalChunks: number; totalSources: number } {
    const sources = new Set(this.chunks.map((c) => c.sourcePath))
    return {
      totalChunks: this.chunks.length,
      totalSources: sources.size,
    }
  }

  private chunkText(text: string): string[] {
    if (text.length <= CHUNK_MAX_LEN) return [text]
    const result: string[] = []
    let start = 0
    while (start < text.length) {
      const end = Math.min(start + CHUNK_MAX_LEN, text.length)
      result.push(text.slice(start, end))
      if (end === text.length) break
      start = end - CHUNK_OVERLAP
    }
    return result
  }
}
