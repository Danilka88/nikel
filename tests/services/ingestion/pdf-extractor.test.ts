import { describe, it, expect, vi, beforeEach } from "vitest"
import { PdfExtractor, PdfPageRenderer } from "../../../src/services/ingestion/pdf-extractor"
import { Logger, OllamaClient } from "../../../src/types"

function createMockRenderer(): PdfPageRenderer {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getPageCount: vi.fn().mockResolvedValue(3),
    renderToBlob: vi.fn().mockResolvedValue(new Blob(["fake-png"], { type: "image/png" })),
    getPageText: vi.fn().mockResolvedValue("Extracted text from page"),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockLogger(): Logger {
  return {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getLogContent: vi.fn().mockResolvedValue(""),
  }
}

function createMockOllama(): OllamaClient {
  return {
    generate: vi.fn(),
    chat: vi.fn()
      .mockResolvedValue("## Page markdown content\n\nTest data"),
    getEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    listModels: vi.fn(),
  }
}

describe("PdfExtractor", () => {
  let extractor: PdfExtractor
  let renderer: PdfPageRenderer
  let ollama: OllamaClient

  beforeEach(() => {
    renderer = createMockRenderer()
    ollama = createMockOllama()
    extractor = new PdfExtractor(ollama, renderer, {
      dpi: 200,
      maxDimension: 1024,
      parallelPages: 2,
      visionModel: "gemma4:e4b",
      ollamaUrl: "http://localhost:11434",
      indexingMode: "vision",
    }, createMockLogger())
  })

  it("processes all pages and returns markdown", async () => {
    const data = new Uint8Array(100)
    const result = await extractor.extractPdf(data)

    expect(renderer.load).toHaveBeenCalledWith(data)
    expect(renderer.getPageCount).toHaveBeenCalledTimes(1)
    expect(renderer.renderToBlob).toHaveBeenCalledTimes(3)
    expect(renderer.close).toHaveBeenCalledTimes(1)
    expect(ollama.chat).toHaveBeenCalledTimes(4)
    expect(result.pageCount).toBe(3)
    expect(result.pages).toHaveLength(3)
    expect(result.markdown).toBeTruthy()
  })

  it("returns empty string for zero page pdf", async () => {
    renderer.getPageCount = vi.fn().mockResolvedValue(0)
    const result = await extractor.extractPdf(new Uint8Array(10))

    expect(result.markdown).toBe("")
    expect(result.pageCount).toBe(0)
    expect(result.pages).toHaveLength(0)
  })

  it("does not aggregate single page", async () => {
    renderer.getPageCount = vi.fn().mockResolvedValue(1)
    const result = await extractor.extractPdf(new Uint8Array(10))

    expect(ollama.chat).toHaveBeenCalledTimes(1)
    expect(result.markdown).toBe("## Page markdown content\n\nTest data")
  })

  it("aggregates multiple pages", async () => {
    renderer.getPageCount = vi.fn().mockResolvedValue(3)
    const result = await extractor.extractPdf(new Uint8Array(10))

    expect(ollama.chat).toHaveBeenCalledTimes(4)
    expect(result.markdown).toBeTruthy()
  })

  it("retries on render failure for each page", async () => {
    const attemptCount = new Map<number, number>()
    renderer.renderToBlob = vi.fn(async (pageNum: number) => {
      const count = (attemptCount.get(pageNum) || 0) + 1
      attemptCount.set(pageNum, count)
      if (count === 1) throw new Error(`render fail for page ${pageNum}`)
      return new Blob(["png"], { type: "image/png" })
    })

    const data = new Uint8Array(10)
    const result = await extractor.extractPdf(data)

    expect(result.pages).toHaveLength(3)
    expect(renderer.renderToBlob).toHaveBeenCalledTimes(6)
  })

  it("allSettled — individual page failure returns empty page strings", async () => {
    renderer.renderToBlob = vi.fn().mockRejectedValue(new Error("persistent fail"))
    ollama.chat = vi.fn()

    const result = await extractor.extractPdf(new Uint8Array(10))
    expect(result.pages).toHaveLength(3)
    expect(result.pages.every((p) => p === "")).toBe(true)
    // markdown = LLM result; undefined here because mock returns void
  })

  it("fast mode uses short text when Vision fallback fails", async () => {
    renderer.getPageText = vi.fn().mockResolvedValue("short")
    renderer.renderToBlob = vi.fn().mockRejectedValue(new Error("vision timeout"))
    const result = await extractor.extractPdf(new Uint8Array(10), "fast")

    expect(result.markdown).toBe("short\n\nshort\n\nshort")
  })

  it("accepts indexingMode override per call", async () => {
    renderer.getPageText = vi.fn().mockResolvedValue("x".repeat(300))
    const result = await extractor.extractPdf(new Uint8Array(10), "fast")

    expect(renderer.getPageText).toHaveBeenCalled()
    expect(renderer.renderToBlob).not.toHaveBeenCalled()
    expect(result.markdown).toBe("x".repeat(300) + "\n\n" + "x".repeat(300) + "\n\n" + "x".repeat(300))
  })

  it("passes correct options to renderer", async () => {
    await extractor.extractPdf(new Uint8Array(10))

    expect(renderer.renderToBlob).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      1024,
    )
  })

  describe("fast mode", () => {
    beforeEach(() => {
      extractor = new PdfExtractor(ollama, renderer, {
        dpi: 200,
        maxDimension: 1024,
        parallelPages: 2,
        visionModel: "gemma4:e4b",
        ollamaUrl: "http://localhost:11434",
        indexingMode: "fast",
      }, createMockLogger())
    })

    it("extracts text via getPageText and skips vision for text-rich pages", async () => {
      renderer.getPageText = vi.fn().mockResolvedValue("x".repeat(300))
      const result = await extractor.extractPdf(new Uint8Array(10))

      expect(renderer.getPageText).toHaveBeenCalledTimes(3)
      expect(renderer.renderToBlob).not.toHaveBeenCalled()
      expect(ollama.chat).not.toHaveBeenCalled()
      expect(result.markdown).toContain("x".repeat(300))
    })

    it("falls back to vision when text under threshold", async () => {
      renderer.getPageText = vi.fn().mockResolvedValue("short text")
      const result = await extractor.extractPdf(new Uint8Array(10))

      expect(renderer.getPageText).toHaveBeenCalledTimes(3)
      expect(renderer.renderToBlob).toHaveBeenCalledTimes(3)
      expect(result.pages).toHaveLength(3)
    })

    it("skips LLM aggregation for 3 or fewer pages", async () => {
      renderer.getPageText = vi.fn().mockResolvedValue("x".repeat(300))
      renderer.getPageCount = vi.fn().mockResolvedValue(3)
      const result = await extractor.extractPdf(new Uint8Array(10))

      expect(ollama.chat).not.toHaveBeenCalled()
      expect(result.markdown).toBe("x".repeat(300) + "\n\n" + "x".repeat(300) + "\n\n" + "x".repeat(300))
    })
  })
})
