import { ChatOptions, Logger, OllamaClient, PdfExtractResult } from "../../types"

const DEFAULT_VISION_PROMPT = `Ты — ассистент для извлечения научной информации. Опиши содержимое этой страницы PDF в формате Markdown. Сохрани: заголовки, таблицы, списки, числовые данные, формулы (LaTeX). Не пропускай подписи к рисункам, сноски, примечания. Если страница содержит таблицу — оформи её в Markdown.`

const AGGREGATION_PROMPT = `Ты получил markdown нескольких страниц одного документа. Объедини их в единый связный документ. Удали дублирующиеся заголовки. Сохрани все данные, таблицы, числовые значения. Не добавляй отсебятины. Верни только объединённый markdown.`

const MAX_RETRIES = 2
const TEXT_THRESHOLD = 200

export type IndexingMode = "vision" | "fast"

export interface PdfPageRenderer {
  load(data: Uint8Array): Promise<void>
  getPageCount(): Promise<number>
  renderToBlob(pageNum: number, dpi: number, maxDimension: number): Promise<Blob>
  getPageText(pageNum: number): Promise<string>
  close(): Promise<void>
}

export class PdfExtractor {
  constructor(
    private _ollama: OllamaClient,
    private _renderer: PdfPageRenderer,
    private _options: { dpi: number; maxDimension: number; parallelPages: number; visionModel: string; ollamaUrl: string; indexingMode: IndexingMode },
    private _logger?: Logger,
  ) {}

  async extractPdf(pdfData: Uint8Array): Promise<PdfExtractResult> {
    await this._renderer.load(pdfData)
    const pageMarkdowns: string[] = []

    try {
      const pageCount = await this._renderer.getPageCount()

      for (let i = 0; i < pageCount; i += this._options.parallelPages) {
        const batch = []
        const end = Math.min(i + this._options.parallelPages, pageCount)
        for (let p = i; p < end; p++) {
          batch.push(this.processPage(p))
        }
        const results = await Promise.all(batch)
        pageMarkdowns.push(...results)
      }

      const markdown = pageCount > 1
        ? await this.aggregatePages(pageMarkdowns, pageCount)
        : (pageMarkdowns[0] || "")

      return { markdown, pageCount, pages: pageMarkdowns }
    } finally {
      await this._renderer.close()
    }
  }

  private async processPage(pageNum: number): Promise<string> {
    if (this._options.indexingMode === "fast") {
      try {
        const text = await this._renderer.getPageText(pageNum)
        const len = text.trim().length
        if (len > TEXT_THRESHOLD) {
          await this._logger?.info(`Page ${pageNum}: fast mode, extracted ${len} chars`, { pageNum: String(pageNum), mode: "fast-extract" })
          return text.trim()
        }
        await this._logger?.warn(`Page ${pageNum}: fast mode ${len} chars < 200 → Vision fallback`, { pageNum: String(pageNum), mode: "fast-fallback", chars: String(len) })
      } catch {
        await this._logger?.warn(`Page ${pageNum}: getPageText failed → Vision fallback`, { pageNum: String(pageNum), mode: "fast-fallback" })
      }
    }

    await this._logger?.info(`Page ${pageNum}: Vision mode`, { pageNum: String(pageNum), mode: "vision" })

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const blob = await this._renderer.renderToBlob(
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
        await this._logger?.warn(`Page ${pageNum}: attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError.message}`, { pageNum: String(pageNum), attempt: String(attempt + 1) })
      }
    }

    throw lastError || new Error(`Failed to process page ${pageNum}`)
  }

  private async aggregatePages(pages: string[], totalPages: number): Promise<string> {
    if (this._options.indexingMode === "fast" && totalPages <= 3) {
      await this._logger?.info(`Skipping LLM aggregation: fast mode, ${totalPages} pages`, { totalPages: String(totalPages), mode: "fast-skip-agg" })
      return pages.join("\n\n")
    }

    await this._logger?.info(`Running LLM aggregation: ${totalPages} pages`, { totalPages: String(totalPages) })

    const chatOpts: ChatOptions = {
      model: this._options.visionModel,
      url: this._options.ollamaUrl,
      messages: [
        { role: "user", content: `${AGGREGATION_PROMPT}\n\n${pages.join("\n\n---\n\n")}` },
      ],
    }

    try {
      return await this._ollama.chat(chatOpts)
    } catch (err) {
      await this._logger?.warn(`LLM aggregation failed, falling back to raw join`, { error: (err instanceof Error ? err.message : String(err)) })
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
