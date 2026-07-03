import { PdfPageRenderer } from "./pdf-extractor"

const VERSION = "4.10.38"
const WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build/pdf.worker.min.mjs`

let pdfjsLib: typeof import("pdfjs-dist") | null = null

async function getPdfLib(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist")
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL
  }
  return pdfjsLib
}

export class DefaultPdfRenderer implements PdfPageRenderer {
  private _doc: any = null

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

    return new Promise((resolve, reject) => {
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
  }

  async close(): Promise<void> {
    if (this._doc) {
      await this._doc.destroy()
      this._doc = null
    }
  }
}
