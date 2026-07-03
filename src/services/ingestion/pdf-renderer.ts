import { PdfPageRenderer } from "./pdf-extractor"

const VERSION = "6.1.200"
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
  async getPageCount(buffer: ArrayBuffer): Promise<number> {
    const pdfjs = await getPdfLib()
    const data = new Uint8Array(buffer.slice(0))
    const doc = await pdfjs.getDocument({ data }).promise
    return doc.numPages
  }

  async renderToBlob(buffer: ArrayBuffer, pageNum: number, dpi: number, maxDimension: number): Promise<Blob> {
    const pdfjs = await getPdfLib()
    const data = new Uint8Array(buffer.slice(0))
    const doc = await pdfjs.getDocument({ data }).promise

    const page = await doc.getPage(pageNum + 1)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.min(dpi / 72, maxDimension / Math.max(viewport.width, viewport.height))
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement("canvas")
    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not get canvas 2D context")

    await page.render({ canvas, viewport: scaledViewport }).promise

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
}
