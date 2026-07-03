import * as path from "path"
import * as fs from "fs/promises"
import type { TextChunk } from "../../types"
import { bm25, cosineSimilarity, semanticChunk, tokenize } from "../../utils"

const BM25_WEIGHT = 0.3
const SEMANTIC_WEIGHT = 0.7
const TOP_K_RERANK = 20

export class DocumentStore {
  private chunks: TextChunk[] = []
  private filePath: string

  constructor(nikelDir: string) {
    this.filePath = path.join(nikelDir, ".nikel", "document-store.json")
  }

  addDocument(sourcePath: string, text: string, pageNum?: number, embeddings?: number[]): void {
    const chunkTexts = semanticChunk(text)
    for (let i = 0; i < chunkTexts.length; i++) {
      const chunk: TextChunk = {
        sourcePath,
        pageNum: pageNum ?? 1,
        chunkIndex: this.chunks.filter((c) => c.sourcePath === sourcePath).length,
        text: chunkTexts[i],
      }
      if (embeddings && i === 0 && chunkTexts.length === 1) {
        chunk.embeddings = embeddings
      }
      this.chunks.push(chunk)
    }
  }

  addChunk(sourcePath: string, text: string, embedding: number[], pageNum?: number): void {
    this.chunks.push({
      sourcePath,
      pageNum: pageNum ?? 1,
      chunkIndex: this.chunks.filter((c) => c.sourcePath === sourcePath).length,
      text,
      embeddings: embedding,
    })
  }

  removeBySource(sourcePath: string): void {
    this.chunks = this.chunks.filter((c) => c.sourcePath !== sourcePath)
  }

  search(query: string, topK = 5, queryEmbedding?: number[]): TextChunk[] {
    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    const hasEmbeddings = this.chunks.some((c) => c.embeddings && c.embeddings.length > 0)

    if (!hasEmbeddings || !queryEmbedding) {
      return this.keywordSearch(queryTerms, topK)
    }

    const avgDocLen = this.chunks.reduce((s, c) => s + tokenize(c.text).length, 0) / Math.max(1, this.chunks.length)
    const docFreqs = this.computeDocFreqs(queryTerms)

    const scored = this.chunks.map((chunk) => {
      const docTerms = tokenize(chunk.text)
      const kwScore = chunk.text ? bm25(queryTerms, docTerms, avgDocLen, docTerms.length, (t) => docFreqs[t] || 0, this.chunks.length) : 0

      let semScore = 0
      if (chunk.embeddings && chunk.embeddings.length > 0) {
        semScore = cosineSimilarity(queryEmbedding, chunk.embeddings)
      }

      return { chunk, score: BM25_WEIGHT * kwScore + SEMANTIC_WEIGHT * semScore }
    })

    return scored
      .filter((s) => s.score > 0.001)
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

  private keywordSearch(queryTerms: string[], topK: number): TextChunk[] {
    const scored = this.chunks.map((chunk) => {
      const textLower = chunk.text.toLowerCase()
      const matchCount = queryTerms.filter((w) => textLower.includes(w)).length
      return { chunk, score: matchCount }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.chunk)
  }

  private computeDocFreqs(terms: string[]): Record<string, number> {
    const freqs: Record<string, number> = {}
    for (const term of terms) {
      freqs[term] = 0
      for (const chunk of this.chunks) {
        if (tokenize(chunk.text).includes(term)) freqs[term]++
      }
    }
    return freqs
  }
}
