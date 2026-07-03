import { PdfPageRenderer } from "./pdf-extractor"

const VERSION = "4.10.38"
const WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build/pdf.worker.min.mjs`

let pdfjsLib: typeof import("pdfjs-dist") | null = null

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      ctrl.signal.addEventListener("abort", () => reject(new Error(`canvas.toBlob timeout (${ms / 1000} сек)`)), { once: true }),
    ),
  ]).finally(() => clearTimeout(timer)) as Promise<T>
}

async function getPdfLib(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist")
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL
  }
  return pdfjsLib
}

type PDFDoc = import("pdfjs-dist").PDFDocumentProxy
type PDFPage = import("pdfjs-dist").PDFPageProxy

export class DefaultPdfRenderer implements PdfPageRenderer {
  private _doc: PDFDoc | null = null

  async load(data: Uint8Array): Promise<void> {
    const pdfjs = await getPdfLib()
    const copy = data.slice()
    this._doc = await pdfjs.getDocument({ data: copy }).promise
  }

  async getPageCount(): Promise<number> {
    if (!this._doc) throw new Error("PDF document not loaded")
    return this._doc.numPages
  }

  async renderToBlob(pageNum: number, dpi: number, maxDimension: number): Promise<Blob> {
    if (!this._doc) throw new Error("PDF document not loaded")

    const page = await this._doc.getPage(pageNum + 1)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.min(dpi / 72, maxDimension / Math.max(viewport.width, viewport.height))
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement("canvas")
    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not get canvas 2D context")

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise

    const blobPromise = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        try {
          canvas.width = 0
          canvas.height = 0
          canvas.remove()
        } catch {
          // canvas may already be detached
        }
        if (blob) resolve(blob)
        else reject(new Error("canvas.toBlob returned null"))
      }, "image/png")
    })

    return withTimeout(blobPromise, 60_000)
  }

  async getPageText(pageNum: number): Promise<string> {
    if (!this._doc) throw new Error("PDF document not loaded")
    const page = await this._doc.getPage(pageNum + 1)
    const content = await page.getTextContent()
    return content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ")
  }

  async close(): Promise<void> {
    if (this._doc) {
      await this._doc.destroy()
      this._doc = null
    }
  }
}
