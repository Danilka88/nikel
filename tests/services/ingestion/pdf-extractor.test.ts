import { describe, it, expect, vi, beforeEach } from "vitest"
import { PdfExtractor, PdfPageRenderer } from "../../../src/services/ingestion/pdf-extractor"
import { OllamaClient } from "../../../src/types"

function createMockRenderer(): PdfPageRenderer {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getPageCount: vi.fn().mockResolvedValue(3),
    renderToBlob: vi.fn().mockResolvedValue(new Blob(["fake-png"], { type: "image/png" })),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockOllama(): OllamaClient {
  return {
    generate: vi.fn(),
    chat: vi.fn()
      .mockResolvedValue("## Page markdown content\n\nTest data"),
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
    })
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

  it("throws after max retries exceeded", async () => {
    renderer.renderToBlob = vi.fn().mockRejectedValue(new Error("persistent fail"))
    ollama.chat = vi.fn()

    await expect(extractor.extractPdf(new Uint8Array(10)))
      .rejects.toThrow("persistent fail")
  })

  it("passes correct options to renderer", async () => {
    await extractor.extractPdf(new Uint8Array(10))

    expect(renderer.renderToBlob).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      1024,
    )
  })
})
