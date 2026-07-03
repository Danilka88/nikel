// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PdfPageRenderer } from "../../src/services/ingestion/pdf-extractor"

const mockGetDocument = vi.fn()
const mockGlobalWorkerOptions = { workerSrc: "" }

vi.mock("pdfjs-dist", () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: mockGlobalWorkerOptions,
}))

function createMinimalPdf(pageCount: number): Uint8Array {
  const objects: string[] = [
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`,
  ]
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ")
  objects.push(`2 0 obj<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>endobj`)
  for (let i = 0; i < pageCount; i++) {
    objects.push(`${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj`)
  }
  const lines = [`%PDF-1.4`]
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(lines.join("\n").length)
    lines.push(obj)
  }
  const xrefOffset = lines.join("\n").length + 1
  lines.push("xref")
  lines.push(`0 ${objects.length + 1}`)
  lines.push("0000000000 65535 f ")
  for (const off of offsets) {
    lines.push(`${String(off).padStart(10, "0")} 00000 n `)
  }
  lines.push("trailer")
  lines.push(`<</Size ${objects.length + 1}/Root 1 0 R>>`)
  lines.push("startxref")
  lines.push(String(xrefOffset))
  lines.push("%%EOF")
  return new TextEncoder().encode(lines.join("\n"))
}

describe("DefaultPdfRenderer with mocked pdfjs v4", () => {
  let DefaultPdfRenderer: typeof import("../../src/services/ingestion/pdf-renderer")["DefaultPdfRenderer"]
  let renderer: PdfPageRenderer

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("../../src/services/ingestion/pdf-renderer")
    DefaultPdfRenderer = mod.DefaultPdfRenderer
    renderer = new DefaultPdfRenderer()
  })

  it("loads PDF via data Uint8Array", async () => {
    const mockPage = {
      getViewport: vi.fn(() => ({ width: 612, height: 792 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      getTextContent: vi.fn(() => Promise.resolve({ items: [{ str: "hello" }] })),
    }
    const mockDoc = {
      numPages: 3,
      getPage: vi.fn(() => Promise.resolve(mockPage)),
      destroy: vi.fn(() => Promise.resolve()),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) })

    const pdfData = createMinimalPdf(3)
    await renderer.load(pdfData)

    expect(mockGetDocument).toHaveBeenCalledTimes(1)
    const args = mockGetDocument.mock.calls[0][0]
    expect(args.data).toBeInstanceOf(Uint8Array)
  })

  it("returns page count and renders from loaded document", async () => {
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        if (tagName === "canvas") {
          const mockCtx = {
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            transform: vi.fn(),
            setTransform: vi.fn(),
            createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          }
          const mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => mockCtx),
            toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
              cb(new Blob(["png-data"], { type: "image/png" }))
            }),
            remove: vi.fn(),
          }
          return mockCanvas as unknown as HTMLCanvasElement
        }
        return origCreateElement(tagName, options)
      },
    )

    const mockPage = {
      getViewport: vi.fn(() => ({ width: 612, height: 792 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      getTextContent: vi.fn(() => Promise.resolve({ items: [{ str: "hello" }] })),
    }
    const mockDoc = {
      numPages: 3,
      getPage: vi.fn(() => Promise.resolve(mockPage)),
      destroy: vi.fn(() => Promise.resolve()),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) })

    await renderer.load(createMinimalPdf(3))

    expect(await renderer.getPageCount()).toBe(3)

    const blob = await renderer.renderToBlob(0, 200, 1024)
    expect(blob).toBeInstanceOf(Blob)
    expect(mockDoc.getPage).toHaveBeenCalledWith(1)
  })

  it("returns extracted text from getPageText", async () => {
    const mockPage = {
      getViewport: vi.fn(() => ({ width: 612, height: 792 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      getTextContent: vi.fn(() => Promise.resolve({
        items: [{ str: "Hello" }, { str: "world" }, { str: "from PDF" }],
      })),
    }
    const mockDoc = {
      numPages: 1,
      getPage: vi.fn(() => Promise.resolve(mockPage)),
      destroy: vi.fn(() => Promise.resolve()),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) })

    await renderer.load(createMinimalPdf(1))
    const text = await renderer.getPageText(0)
    expect(text).toBe("Hello world from PDF")
    expect(mockDoc.getPage).toHaveBeenCalledWith(1)
    expect(mockPage.getTextContent).toHaveBeenCalledTimes(1)
  })

  it("closes and reopens document", async () => {
    const mockPage = {
      getViewport: vi.fn(() => ({ width: 612, height: 792 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      getTextContent: vi.fn(() => Promise.resolve({ items: [{ str: "hello" }] })),
    }
    const mockDoc = {
      numPages: 3,
      getPage: vi.fn(() => Promise.resolve(mockPage)),
      destroy: vi.fn(() => Promise.resolve()),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) })

    await renderer.load(createMinimalPdf(1))
    await renderer.close()
    expect(mockDoc.destroy).toHaveBeenCalled()

    mockGetDocument.mockClear()
    mockDoc.destroy.mockClear()

    await renderer.load(createMinimalPdf(5))
    expect(mockGetDocument).toHaveBeenCalledTimes(1)
    await renderer.close()
  })
})
