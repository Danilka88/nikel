import { PdfExtractResult } from "../../types"

const mammoth = require("mammoth") as {
  convertToMarkdown(opts: { buffer: Uint8Array }): Promise<{ value: string }>
}

export class TextExtractor {
  async extractTxt(data: Uint8Array): Promise<PdfExtractResult> {
    let text = new TextDecoder().decode(data)
    text = text.replace(/^\uFEFF/, "")
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    return { markdown: text, pageCount: 1, pages: [text] }
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
