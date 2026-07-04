import { describe, it, expect } from "vitest"
import {
  getSubDir,
  safeFileName,
  detectSourceType,
  resolvePdfMode,
  toErrorMessage,
  cosineSimilarity,
  bm25,
  tokenize,
  semanticChunk,
  createEmptyManifest,
} from "../../src/utils"

describe("getSubDir", () => {
  it("returns correct dir for new entity types", () => {
    expect(getSubDir("publication")).toBe("publications")
    expect(getSubDir("process")).toBe("processes")
    expect(getSubDir("facility")).toBe("facilities")
  })

  it("returns correct dir for existing entity types", () => {
    expect(getSubDir("material")).toBe("materials")
    expect(getSubDir("experiment")).toBe("experiments")
  })

  it("returns 'other' for unknown types", () => {
    expect(getSubDir("unknown")).toBe("other")
  })
})

describe("safeFileName", () => {
  it("removes invalid filesystem characters", () => {
    expect(safeFileName("test:file?name*")).toBe("test-file-name")
  })
})

describe("detectSourceType", () => {
  it("detects 'article' from Статьи folder", () => {
    expect(detectSourceType("Статьи/ivanov2024.pdf")).toBe("article")
  })

  it("detects 'report' from Доклады folder", () => {
    expect(detectSourceType("Доклады/report-2024.pdf")).toBe("report")
  })

  it("detects 'conference' from Материалы конференций folder", () => {
    expect(detectSourceType("Материалы конференций/conf-2024.pdf")).toBe("conference")
  })

  it("detects 'review' from Обзоры folder", () => {
    expect(detectSourceType("Обзоры/review-2024.pdf")).toBe("review")
  })

  it("returns 'other' for unknown folder", () => {
    expect(detectSourceType("Other/docs.pdf")).toBe("other")
  })

  it("handles nested paths", () => {
    expect(detectSourceType("base/Статьи/sub/paper.pdf")).toBe("article")
  })
})

describe("resolvePdfMode", () => {
  it("returns 'fast' for direct mode", () => {
    expect(resolvePdfMode("direct")).toBe("fast")
  })

  it("passes through vision mode", () => {
    expect(resolvePdfMode("vision")).toBe("vision")
  })

  it("passes through fast mode", () => {
    expect(resolvePdfMode("fast")).toBe("fast")
  })
})

describe("toErrorMessage", () => {
  it("returns message from Error", () => {
    expect(toErrorMessage(new Error("test error"))).toBe("test error")
  })

  it("returns String representation for non-Error", () => {
    expect(toErrorMessage("string error")).toBe("string error")
    expect(toErrorMessage(42)).toBe("42")
    expect(toErrorMessage(null)).toBe("null")
  })
})

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5)
  })

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it("returns 0 for zero-length vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
    expect(cosineSimilarity([1, 0], [0, 0])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it("computes cosine between parallel vectors", () => {
    const result = cosineSimilarity([2, 0], [4, 0])
    expect(result).toBeCloseTo(1, 5)
  })
})

describe("bm25", () => {
  it("scores higher for matching terms", () => {
    const docTerms = tokenize("nickel sulfate concentration")
    const queryTerms = tokenize("nickel sulfate")
    const score = bm25(queryTerms, docTerms, 5, docTerms.length, () => 0, 10)
    expect(score).toBeGreaterThan(0)
  })

  it("returns 0 for no matching terms", () => {
    const docTerms = tokenize("copper zinc")
    const queryTerms = tokenize("nickel")
    const score = bm25(queryTerms, docTerms, 5, docTerms.length, () => 0, 10)
    expect(score).toBe(0)
  })

  it("penalizes high document frequency", () => {
    const docTerms = tokenize("the test")
    const queryTerms = tokenize("the")
    const highDf = bm25(queryTerms, docTerms, 5, docTerms.length, () => 100, 100)
    const lowDf = bm25(queryTerms, docTerms, 5, docTerms.length, () => 1, 100)
    expect(highDf).toBeLessThan(lowDf)
  })

  it("handles empty query", () => {
    expect(bm25([], [], 5, 0, () => 0, 10)).toBe(0)
  })
})

describe("tokenize", () => {
  it("splits text into lowercase tokens", () => {
    expect(tokenize("Nickel Sulfate")).toEqual(["nickel", "sulfate"])
  })

  it("handles cyrillic text", () => {
    expect(tokenize("Концентрация сульфатов")).toEqual(["концентрация", "сульфатов"])
  })

  it("removes punctuation", () => {
    expect(tokenize("nickel.sulfate! test;")).toEqual(["nickel", "sulfate", "test"])
  })

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([])
    expect(tokenize("   ")).toEqual([])
  })
})

describe("semanticChunk", () => {
  it("returns empty array for empty text", () => {
    expect(semanticChunk("")).toEqual([])
  })

  it("returns single chunk for short text", () => {
    expect(semanticChunk("short text")).toEqual(["short text"])
  })

  it("does not split small paragraphs (merges under maxSize)", () => {
    const text = "one.\n\ntwo.\n\nthree."
    const chunks = semanticChunk(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain("one.")
    expect(chunks[0]).toContain("three.")
  })

  it("splits oversized paragraph into multiple chunks", () => {
    const text = "a".repeat(2500)
    const chunks = semanticChunk(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length > 0)).toBe(true)
  })
})

describe("createEmptyManifest", () => {
  it("creates manifest with default values", () => {
    const manifest = createEmptyManifest()
    expect(manifest.version).toBe(1)
    expect(manifest.files).toEqual({})
    expect(manifest.entities).toEqual([])
    expect(manifest.relations).toEqual([])
    expect(typeof manifest.lastIndexed).toBe("string")
  })
})
