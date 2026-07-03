import { ChatOptions, OllamaClient, PdfExtractResult } from "../../types"

const DEFAULT_VISION_PROMPT = `Ты — ассистент для извлечения научной информации. Опиши содержимое этой страницы PDF в формате Markdown. Сохрани: заголовки, таблицы, списки, числовые данные, формулы (LaTeX). Не пропускай подписи к рисункам, сноски, примечания. Если страница содержит таблицу — оформи её в Markdown.`

const AGGREGATION_PROMPT = `Ты получил markdown нескольких страниц одного документа. Объедини их в единый связный документ. Удали дублирующиеся заголовки. Сохрани все данные, таблицы, числовые значения. Не добавляй отсебятины. Верни только объединённый markdown.`

const MAX_RETRIES = 2

export interface PdfPageRenderer {
  renderToBlob(buffer: ArrayBuffer, pageNum: number, dpi: number, maxDimension: number): Promise<Blob>
  getPageCount(buffer: ArrayBuffer): Promise<number>
}

export class PdfExtractor {
  constructor(
    private _ollama: OllamaClient,
    private _renderer: PdfPageRenderer,
    private _options: { dpi: number; maxDimension: number; parallelPages: number; visionModel: string; ollamaUrl: string },
  ) {}

  async extractPdf(pdfBuffer: ArrayBuffer): Promise<PdfExtractResult> {
    const pageCount = await this._renderer.getPageCount(pdfBuffer)
    const pageMarkdowns: string[] = []

    for (let i = 0; i < pageCount; i += this._options.parallelPages) {
      const batch = []
      const end = Math.min(i + this._options.parallelPages, pageCount)
      for (let p = i; p < end; p++) {
        batch.push(this.processPage(pdfBuffer, p))
      }
      const results = await Promise.all(batch)
      pageMarkdowns.push(...results)
    }

    const markdown = pageCount > 1
      ? await this.aggregatePages(pageMarkdowns)
      : (pageMarkdowns[0] || "")

    return { markdown, pageCount, pages: pageMarkdowns }
  }

  private async processPage(buffer: ArrayBuffer, pageNum: number): Promise<string> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const blob = await this._renderer.renderToBlob(
          buffer,
          pageNum,
          this._options.dpi,
          this._options.maxDimension,
        )

        const base64 = await blobToBase64(blob)
        const chatOpts: ChatOptions = {
          model: this._options.visionModel,
          url: this._options.ollamaUrl,
          messages: [
            {
              role: "user",
              content: DEFAULT_VISION_PROMPT,
              images: [base64],
            },
          ],
        }

        return await this._ollama.chat(chatOpts)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    throw lastError || new Error(`Failed to process page ${pageNum}`)
  }

  private async aggregatePages(pages: string[]): Promise<string> {
    const chatOpts: ChatOptions = {
      model: this._options.visionModel,
      url: this._options.ollamaUrl,
      messages: [
        { role: "user", content: `${AGGREGATION_PROMPT}\n\n${pages.join("\n\n---\n\n")}` },
      ],
    }

    try {
      return await this._ollama.chat(chatOpts)
    } catch {
      return pages.join("\n\n")
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
