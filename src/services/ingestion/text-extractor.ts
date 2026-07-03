import { PdfExtractResult } from "../../types"

const mammoth = require("mammoth") as {
  convertToMarkdown(opts: { buffer: Uint8Array }): Promise<{ value: string }>
}

export class TextExtractor {
  async extractTxt(data: Uint8Array): Promise<PdfExtractResult> {
    const markdown = new TextDecoder().decode(data).replace(/\r\n/g, "\n")
    return { markdown, pageCount: 1, pages: [markdown] }
  }

  async extractDocx(data: Uint8Array): Promise<PdfExtractResult> {
    try {
      const result = await mammoth.convertToMarkdown({ buffer: data })
      return { markdown: result.value || "", pageCount: 1, pages: [result.value || ""] }
    } catch {
      return { markdown: "", pageCount: 0, pages: [] }
    }
  }
}
