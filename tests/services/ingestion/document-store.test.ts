import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { DocumentStore } from "../../../src/services/ingestion/document-store"

describe("DocumentStore", () => {
  let store: DocumentStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `nikel-ds-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    store = new DocumentStore(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("adds document and chunks long text", () => {
    const text = "A".repeat(2500)
    store.addDocument("/path/file.txt", text)

    const stats = store.stats
    expect(stats.totalChunks).toBe(3)
    expect(stats.totalSources).toBe(1)
  })

  it("single chunk for short text", () => {
    store.addDocument("/path/short.txt", "Hello world")
    expect(store.stats.totalChunks).toBe(1)
  })

  it("search finds matching chunks", () => {
    store.addDocument("/path/doc1.txt", "lithium ion battery anode silicon")
    store.addDocument("/path/doc2.txt", "nickel manganese cobalt cathode")
    store.addDocument("/path/doc3.txt", "solid state electrolyte conductivity")

    const results = store.search("lithium battery")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].sourcePath).toBe("/path/doc1.txt")
  })

  it("search returns empty for no match", () => {
    store.addDocument("/path/doc1.txt", "lithium ion battery")
    const results = store.search("graphene quantum dots")
    expect(results).toHaveLength(0)
  })

  it("search respects topK", () => {
    store.addDocument("/path/doc1.txt", "lithium battery anode")
    store.addDocument("/path/doc2.txt", "lithium cathode material")
    store.addDocument("/path/doc3.txt", "lithium electrolyte salt")

    const results = store.search("lithium", 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it("removes chunks by source path", () => {
    store.addDocument("/path/doc1.txt", "lithium battery")
    store.addDocument("/path/doc2.txt", "nickel cathode")
    store.removeBySource("/path/doc1.txt")

    expect(store.stats.totalChunks).toBe(1)
    expect(store.stats.totalSources).toBe(1)
  })

  it("persists and reloads", async () => {
    store.addDocument("/path/doc1.txt", "lithium battery")
    await store.save()

    const reloaded = new DocumentStore(tmpDir)
    await reloaded.load()

    expect(reloaded.stats.totalChunks).toBe(1)
    expect(reloaded.stats.totalSources).toBe(1)

    const results = reloaded.search("lithium")
    expect(results).toHaveLength(1)
  })

  it("clear removes all chunks", () => {
    store.addDocument("/path/doc1.txt", "lithium battery")
    store.clear()
    expect(store.stats.totalChunks).toBe(0)
    expect(store.stats.totalSources).toBe(0)
  })

  it("adds document with page number", () => {
    store.addDocument("/path/doc1.txt", "page text", 5)
    const searchResults = store.search("page text")
    expect(searchResults[0].pageNum).toBe(5)
  })

  it("load returns empty array for missing file", async () => {
    const empty = new DocumentStore(tmpDir)
    await empty.load()
    expect(empty.stats.totalChunks).toBe(0)
  })
})
