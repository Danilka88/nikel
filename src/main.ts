import * as path from "path"
import * as fs from "fs/promises"
import {
  Plugin,
  MarkdownView,
  Notice,
  addIcon,
  TFile,
  Editor,
} from "obsidian"
import {
  NikelSettings,
  DEFAULT_SETTINGS,
  PdfExtractResult,
  TriggerMatch,
  type OllamaClient,
  type Provider,
} from "./types"
import { detectSourceType, resolvePdfMode, semanticChunk, toErrorMessage } from "./utils"
import { NikelSuggester } from "./suggester"
import { DefaultOllamaClient } from "./services/ollama"
import { YandexGPTClient } from "./services/yandex-gpt"

import { findTrigger, buildPrompt } from "./services/trigger-parser"
import { formatResponse } from "./services/response-formatter"
import { NikelSettingTab } from "./settings/settings-tab"
import { ProgressModal } from "./ui/progress-modal"
import { FileWatcher } from "./services/ingestion/file-watcher"
import { KnowledgeGraph } from "./services/graph/knowledge-graph"
import { QueryEngine } from "./services/graph/query-engine"
import { EntityExtractor } from "./services/ingestion/entity-extractor"
import { PdfExtractor } from "./services/ingestion/pdf-extractor"
import { DefaultPdfRenderer } from "./services/ingestion/pdf-renderer"
import { TextExtractor } from "./services/ingestion/text-extractor"
import { DocumentStore } from "./services/ingestion/document-store"
import { FileLogger } from "./services/log-service"
import { MdGenerator } from "./services/generation/md-generator"
import { IndexGenerator } from "./services/generation/index-generator"
import { CanvasGenerator } from "./services/generation/canvas-generator"

const NIKEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5"/><text x="50" y="50" text-anchor="middle" dy=".35em" font-size="40" fill="currentColor" font-weight="bold">N</text></svg>`

export default class NikelPlugin extends Plugin {
  settings!: NikelSettings
  suggester!: NikelSuggester
  ollama!: OllamaClient
  fileWatcher!: FileWatcher
  graph!: KnowledgeGraph
  queryEngine!: QueryEngine
  entityExtractor!: EntityExtractor
  pdfExtractor!: PdfExtractor
  textExtractor!: TextExtractor
  logger!: FileLogger
  mdGenerator!: MdGenerator
  indexGenerator!: IndexGenerator
  canvasGenerator!: CanvasGenerator
  documentStore!: DocumentStore
  isIndexing = false
  onIndexingChange: ((running: boolean) => void) | null = null

  async onload(): Promise<void> {
    await this.loadSettings()
    this.ollama = this.buildLlmClient()
    addIcon("nikel", NIKEL_ICON)

    this.initKnowledgeGraphServices()

    await this.logger.checkVersion(this.manifest.version)
    await this.logger.info("Plugin loaded", { version: this.manifest.version })

    this.suggester = new NikelSuggester(this)
    this.registerEditorSuggest(this.suggester)

    this.addCommand({
      id: "process-nikel-task",
      name: "Process @nikel task",
      icon: "nikel",
      callback: () => this.processNikelTask(),
    })

    this.addCommand({
      id: "nikel-index-sources",
      name: "Индексировать папки источников",
      icon: "nikel",
      callback: () => this.runIndexing(),
    })

    this.addSettingTab(new NikelSettingTab(this.app, this))
  }

  private get vaultBasePath(): string {
    const adapter = this.app.vault.adapter
    if ("basePath" in adapter) {
      return (adapter as { basePath: string }).basePath
    }
    return ""
  }

  private initKnowledgeGraphServices(): void {
    const vaultDir = this.vaultBasePath
    const nikelDir = vaultDir ? `${vaultDir}/${this.settings.nikelDir}` : this.settings.nikelDir

    this.logger = new FileLogger(nikelDir)
    this.fileWatcher = new FileWatcher(nikelDir)
    this.graph = new KnowledgeGraph(path.join(nikelDir, "index.json"))
    this.entityExtractor = new EntityExtractor(this.ollama, {
      model: this.settings.model,
      url: this.settings.ollamaUrl,
    })
    this.queryEngine = new QueryEngine(this.graph, this.ollama, {
      model: this.settings.model,
      url: this.settings.ollamaUrl,
      nikelDir: this.settings.nikelDir,
    })
    this.textExtractor = new TextExtractor()
    this.mdGenerator = new MdGenerator(nikelDir)
    this.indexGenerator = new IndexGenerator(nikelDir)
    this.canvasGenerator = new CanvasGenerator(nikelDir, this.settings.nikelDir)
    this.documentStore = new DocumentStore(nikelDir)

    this.pdfExtractor = new PdfExtractor(
      this.ollama,
      new DefaultPdfRenderer(),
      {
        dpi: 200,
        maxDimension: 1024,
        parallelPages: 2,
        visionModel: "gemma4:e4b",
        ollamaUrl: this.settings.ollamaUrl,
        indexingMode: resolvePdfMode(this.settings.indexingMode),
      },
      this.logger,
    )
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    this.autoSwitchForProvider()
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  private buildLlmClient(): OllamaClient {
    const ollamaClient = new DefaultOllamaClient()
    const yandexKey = this.getYandexApiKey()
    const yandexClient = yandexKey && this.settings.yandexFolderId
      ? new YandexGPTClient(yandexKey, this.settings.yandexFolderId)
      : null

    if (this.settings.provider === "yandex") {
      if (!yandexClient) {
        new Notice("YandexGPT: не указан API-ключ или ID каталога. Используется Ollama.")
        return ollamaClient
      }
      return new FallbackLLMClient(
        yandexClient, ollamaClient,
        this.settings.yandexModel, this.settings.model,
        this.settings.ollamaUrl, this.logger,
      )
    }

    if (yandexClient) {
      return new FallbackLLMClient(
        ollamaClient, yandexClient,
        this.settings.model, this.settings.yandexModel,
        this.settings.ollamaUrl, this.logger,
      )
    }

    return ollamaClient
  }

  private autoSwitchForProvider(): void {
    if (this.settings.provider !== "yandex") return

    if (this.settings.indexingMode === "vision") {
      this.settings.indexingMode = "fast"
      new Notice("YandexGPT: режим индексации переключён на «Быстрый» (Vision не поддерживается)")
    }

    if (this.settings.embeddingEnabled) {
      this.settings.embeddingEnabled = false
      new Notice("YandexGPT: эмбеддинги отключены (не поддерживаются)")
    }
  }

  private getYandexApiKey(): string {
    try {
      return localStorage.getItem("nikel-yandex-api-key") || ""
    } catch {
      return ""
    }
  }

  async runIndexing(): Promise<void> {
    if (this.isIndexing) {
      new Notice("Индексация уже запущена")
      return
    }
    this.isIndexing = true
    this.onIndexingChange?.(true)

    try {
      await this._doIndexing()
    } finally {
      this.isIndexing = false
      this.onIndexingChange?.(false)
    }
  }

  private async _doIndexing(): Promise<void> {
    const folders = [
      { path: this.settings.pdfFolder, exts: [".pdf"], label: "PDF" },
      { path: this.settings.txtFolder, exts: [".txt"], label: "TXT" },
      { path: this.settings.docxFolder, exts: [".docx"], label: "DOCX" },
    ].filter((f) => f.path)

    if (folders.length === 0) {
      new Notice("Укажите хотя бы одну папку с файлами в настройках Nikel")
      return
    }

    const modal = new ProgressModal(this.app, "Индексация")
    modal.open()

    await this.logger.clear(this.manifest.version)
    for (const f of folders) {
      await this.logger.info(`Source folder: ${f.label}`, { path: f.path })
    }

    try {
      modal.setProgress(0, 1, "Сканирую папки...")
      if (this.settings.indexingMode === "direct") {
        await this.documentStore.load()
      } else {
        await this.graph.load()
      }

      const allNew: string[] = []
      const allChanged: string[] = []
      const allDeleted: string[] = []
      const fileToFolder = new Map<string, string>()

      for (const f of folders) {
        const changes = await this.fileWatcher.scan(f.path, f.exts)
        for (const fp of changes.newFiles) fileToFolder.set(fp, f.path)
        for (const fp of changes.changedFiles) fileToFolder.set(fp, f.path)
        allNew.push(...changes.newFiles)
        allChanged.push(...changes.changedFiles)
        allDeleted.push(...changes.deletedFiles)
      }

      const totalChanges = allNew.length + allChanged.length + allDeleted.length

      if (totalChanges === 0) {
        modal.close()
        await this.logger.info("No changes found, all files are current")
        new Notice("✅ Изменений не найдено. Все файлы актуальны.")
        return
      }

      await this.logger.info(`Found ${totalChanges} changes: ${allNew.length} new, ${allChanged.length} changed, ${allDeleted.length} deleted`)

      if (this.settings.indexingMode === "direct") {
        for (const filePath of allDeleted) {
          this.documentStore.removeBySource(filePath)
        }
      } else {
        for (const filePath of allDeleted) {
          this.graph.removeBySource(filePath)
        }
      }
      const processedFiles = [...allNew, ...allChanged]
      const totalFiles = processedFiles.length
      const successfullyProcessed: string[] = []

      for (let i = 0; i < totalFiles; i++) {
        const filePath = processedFiles[i]
        const fileName = filePath.split("/").pop() || filePath
        modal.setProgress(i + 1, totalFiles, `Обрабатываю: ${fileName}`)

        await this.logger.info(`Processing: ${fileName}`, { file: filePath, index: String(i + 1), total: String(totalFiles) })

        const raw = await fs.readFile(filePath)
        const data = Uint8Array.from(raw)
        const ext = path.extname(filePath).toLowerCase()

        try {
          let extractResult: PdfExtractResult

          if (ext === ".pdf") {
            extractResult = await this.pdfExtractor.extractPdf(data, resolvePdfMode(this.settings.indexingMode))
            await this.logger.info(`PDF extracted: ${extractResult.pageCount} pages`, { file: fileName, pages: String(extractResult.pageCount) })
          } else if (ext === ".txt") {
            extractResult = await this.textExtractor.extractTxt(data)
            await this.logger.info(`TXT extracted: ${extractResult.markdown.length} chars`, { file: fileName })
          } else if (ext === ".docx") {
            extractResult = await this.textExtractor.extractDocx(data)
            await this.logger.info(`DOCX extracted: ${extractResult.markdown.length} chars`, { file: fileName })
          } else {
            await this.logger.warn(`Unsupported file type: ${ext}`, { file: fileName })
            continue
          }

          if (this.settings.indexingMode === "direct") {
            if (ext === ".pdf") {
              for (let p = 0; p < extractResult.pages.length; p++) {
                await this.addWithEmbeddings(filePath, extractResult.pages[p], p + 1)
              }
            } else {
              await this.addWithEmbeddings(filePath, extractResult.markdown)
            }
          } else {
            const result = await this.entityExtractor.extract(
              extractResult.markdown,
              filePath,
            )

            const folderPath = fileToFolder.get(filePath)
            const folderBase = folderPath || folders[0]?.path || ""
            const relPath = folderBase ? path.relative(folderBase, filePath) : fileName
            const sourceType = detectSourceType(relPath)
            for (const entity of result.entities) {
              entity.sourceType = sourceType
            }

            await this.logger.info(`Entities extracted: ${result.entities.length} entities, ${result.relations.length} relations`, { file: fileName, entities: String(result.entities.length), relations: String(result.relations.length) })

            if (result.entities.length > 0) {
              this.graph.mergeIndex({
                version: 1,
                lastIndexed: new Date().toISOString(),
                files: {},
                entities: result.entities,
                relations: result.relations,
              })
            } else {
              await this.logger.warn(`No entities extracted from ${fileName}`)
            }
          }
          successfullyProcessed.push(filePath)
        } catch (fileErr) {
          await this.logger.error(`Failed to process ${fileName}: ${toErrorMessage(fileErr)}`, { file: fileName })
          new Notice(`⚠️ Ошибка при обработке ${fileName}: ${toErrorMessage(fileErr)}`)
        }
      }

      if (this.settings.indexingMode === "direct") {
        await this.documentStore.save()

        const hashManifest = await this.fileWatcher.loadManifest()
        hashManifest.lastIndexed = new Date().toISOString()
        const hashFiles = successfullyProcessed.length > 0 ? successfullyProcessed : processedFiles
        await this.fileWatcher.updateFileHashes(hashFiles, hashManifest)
        await this.fileWatcher.removeFileHashes(allDeleted, hashManifest)
        await this.fileWatcher.saveManifest(hashManifest)

        modal.setProgress(100, 100, "Сохранение завершено")
        modal.close()
        const ds = this.documentStore.stats
        await this.logger.info(`Direct indexing complete: ${ds.totalChunks} chunks from ${ds.totalSources} sources`)
        new Notice(`✅ Индексация завершена. ${ds.totalChunks} текстовых блоков из ${ds.totalSources} файлов.`)
      } else {
        const hashFiles = successfullyProcessed.length > 0 ? successfullyProcessed : processedFiles
        await this.fileWatcher.updateFileHashes(hashFiles, this.graph.manifest)
        await this.fileWatcher.removeFileHashes(allDeleted, this.graph.manifest)

        this.graph.manifest.lastIndexed = new Date().toISOString()
        await this.graph.save()
        await this.fileWatcher.saveManifest(this.graph.manifest)

        const vaultBase = this.vaultBasePath
        let generatedCount = 0
        for (const entity of this.graph.entities) {
          const doc = this.mdGenerator.generateDoc(entity, this.graph.relations)
          const vaultRelPath = vaultBase && doc.path.startsWith(vaultBase)
            ? doc.path.slice(vaultBase.length + 1)
            : `${this.settings.nikelDir}/_answers/${doc.path.split("/").pop()}`
          const exists = this.app.vault.getAbstractFileByPath(vaultRelPath)
          if (!exists) {
            try {
              await this.app.vault.create(vaultRelPath, doc.content)
              generatedCount++
            } catch (createErr) {
              await this.logger.warn(`Failed to create note for ${entity.name}`, { error: toErrorMessage(createErr) })
            }
          }
        }

        const indexContent = this.indexGenerator.generateIndex(this.graph.manifest)
        const indexRelPath = `${this.settings.nikelDir}/_index.md`
        const existingIndex = this.app.vault.getAbstractFileByPath(indexRelPath)
        if (existingIndex instanceof TFile) {
          await this.app.vault.modify(existingIndex, indexContent)
        } else {
          await this.app.vault.create(indexRelPath, indexContent)
        }

        const graphContent = this.indexGenerator.generateGraphMermaid(this.graph.manifest)
        const graphRelPath = `${this.settings.nikelDir}/_graph.md`
        const existingGraph = this.app.vault.getAbstractFileByPath(graphRelPath)
        if (existingGraph instanceof TFile) {
          await this.app.vault.modify(existingGraph, graphContent)
        } else {
          await this.app.vault.create(graphRelPath, graphContent)
        }

        const overviewCanvas = this.canvasGenerator.generateGlobalOverview(this.graph)
        const canvasRelPath = `${this.settings.nikelDir}/canvas/обзор-базы-знаний.canvas`
        const existingCanvas = this.app.vault.getAbstractFileByPath(canvasRelPath)
        const canvasContent = JSON.stringify({ nodes: overviewCanvas.nodes, edges: overviewCanvas.edges }, null, 2)
        if (existingCanvas instanceof TFile) {
          await this.app.vault.modify(existingCanvas, canvasContent)
        } else {
          await this.app.vault.create(canvasRelPath, canvasContent)
        }

        modal.setProgress(100, 100, "Сохранение завершено")
        modal.close()

        const stats = this.graph.getStats()
        await this.logger.info(`Indexing complete: ${stats.entityCount} entities, ${stats.relationCount} relations, ${generatedCount} notes created`)
        new Notice(`✅ Индексация завершена. Сущностей: ${stats.entityCount}, связей: ${stats.relationCount}. Создано заметок: ${generatedCount}`)
      }
    } catch (e) {
      modal.close()
      const msg = toErrorMessage(e)
      await this.logger.error(`Indexing failed: ${msg}`)
      new Notice(`❌ Ошибка индексации: ${msg}`)
    }
  }

  async processNikelTask(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view) {
      new Notice("Откройте редактор заметок")
      return
    }

    const editor = view.editor
    const cursorLine = editor.getCursor().line
    const lines: string[] = []
    for (let i = 0; i < editor.lineCount(); i++) {
      lines.push(editor.getLine(i))
    }

    const match = findTrigger(lines, this.settings.commands, cursorLine)
    if (!match) {
      new Notice("Не найден @nikel_* триггер выше курсора")
      return
    }

    if (!match.input) {
      new Notice(`Нет текста после ${match.command.trigger}. Напишите задачу после триггера`)
      return
    }

    const hasSource = this.settings.pdfFolder || this.settings.txtFolder || this.settings.docxFolder

    if (this.settings.indexingMode === "direct" && hasSource) {
      await this.processWithDirectSearch(match.input, match.line, editor)
    } else {
      const isGraphMode = hasSource && this.graph.entities.length > 0
      if (isGraphMode) {
        await this.processWithGraph(match.input, match.line, editor)
      } else {
        await this.processDirect(match, editor)
      }
    }
  }

  async exportLog(): Promise<string> {
    const vaultDir = this.vaultBasePath
    const nikelDir = vaultDir ? `${vaultDir}/${this.settings.nikelDir}` : this.settings.nikelDir
    const logContent = await this.logger.getLogContent()
    if (!logContent) return ""

    const lines = logContent.split("\n").length
    const date = new Date().toISOString().slice(0, 10)
    const exportPath = `${nikelDir}/_log-export.md`
    const vaultRelPath = `${this.settings.nikelDir}/_log-export.md`
    const frontmatter = `---\ntype: log-export\ncreated: ${date}\nplugin: ${this.manifest.version}\nlines: ${lines}\n---\n`
    const mdContent = frontmatter + "```\n" + logContent + "\n```\n"

    const existing = this.app.vault.getAbstractFileByPath(vaultRelPath)
    try {
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, mdContent)
      } else {
        await this.app.vault.create(vaultRelPath, mdContent)
      }
    } catch (e) {
      await this.logger.warn(`vault write failed, falling back to fs`, { error: toErrorMessage(e) })
      await fs.writeFile(exportPath, mdContent, "utf-8")
    }
    return vaultRelPath
  }

  private async processWithGraph(
    input: string,
    triggerLine: number,
    editor: Editor,
  ): Promise<void> {
    await this.logger.info("processWithGraph", { input: input.slice(0, 100) })
    new Notice("🔍 Ищу в базе знаний...")

    try {
      const result = await this.queryEngine.answerQuestion(input)

      const doc = this.mdGenerator.generateAnswerDoc(result, input, this.settings.model)

      const vaultBase = this.vaultBasePath
      const vaultRelPath = vaultBase && doc.path.startsWith(vaultBase)
        ? doc.path.slice(vaultBase.length + 1)
        : this.settings.nikelDir + "/_answers/" + doc.path.split("/").pop()

      const answersDir = `${this.settings.nikelDir}/_answers`
      const answersDirExists = this.app.vault.getAbstractFileByPath(answersDir)
      if (!answersDirExists) {
        await this.app.vault.createFolder(answersDir)
      }

      let answerFile: TFile | null = null
      try {
        answerFile = await this.app.vault.create(vaultRelPath, doc.content)
      } catch (createErr) {
        await this.logger.warn(`vault.create failed for answer doc, trying modify`, { error: toErrorMessage(createErr) })
        const existing = this.app.vault.getAbstractFileByPath(vaultRelPath)
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, doc.content)
          answerFile = existing
        }
      }

      const insertLine = Math.min(triggerLine + 1, editor.lineCount())
      if (answerFile) {
        editor.replaceRange(
          `\n> **Ответ сохранён:** [[${vaultRelPath}]]\n`,
          { line: insertLine, ch: 0 },
          { line: insertLine, ch: 0 },
        )
        new Notice(`✅ Ответ сохранён: ${vaultRelPath}`)
      } else {
        const contextBlock = result.contextMd.split("\n").map((l) => `> ${l}`).join("\n")
        const answerBlock = result.answer.split("\n").join("\n> ")
        editor.replaceRange(
          `\n> **Контекст из базы знаний:**\n${contextBlock}\n>\n> **Ответ:**\n> ${answerBlock}\n`,
          { line: insertLine, ch: 0 },
          { line: insertLine, ch: 0 },
        )
        new Notice("✅ Ответ вставлен")
      }
    } catch (e) {
      await this.logger.error(`processWithGraph failed: ${toErrorMessage(e)}`)
      new Notice(`❌ Ошибка: ${toErrorMessage(e)}`)
    }
  }

  private async processWithDirectSearch(
    input: string,
    triggerLine: number,
    editor: Editor,
  ): Promise<void> {
    await this.logger.info("processWithDirectSearch", { input: input.slice(0, 100) })
    new Notice("🔍 Ищу в текстовом индексе...")

    try {
      const rewrittenQuery = await this.rewriteQuery(input)
      await this.logger.info("Query rewritten", { original: input.slice(0, 100), rewritten: rewrittenQuery.slice(0, 100) })

      let queryEmbedding: number[] | undefined
      if (this.settings.embeddingEnabled) {
        try {
          const result = await this.ollama.getEmbeddings({
            model: this.settings.embeddingModel,
            url: this.settings.ollamaUrl,
            input: rewrittenQuery,
          })
          if (result.length > 0) queryEmbedding = result[0]
        } catch (e) {
          await this.logger.warn("Query embedding failed, falling back to keyword search", { error: toErrorMessage(e) })
        }
      }

      let chunks = this.documentStore.search(rewrittenQuery, 5, queryEmbedding)

      if (chunks.length === 0) {
        chunks = this.documentStore.search(input, 3)
        if (chunks.length === 0) {
          new Notice("Ничего не найдено в индексе")
          return
        }
      }

      const contextParts = chunks.map(
        (c, i) => `[Источник ${i + 1}]: ${c.sourcePath} (стр. ${c.pageNum})\n${c.text}`,
      )
      const context = contextParts.join("\n\n---\n\n")

      const response = await this.ollama.chat({
        messages: [
          {
            role: "system",
            content: `Ты — полезный AI-ассистент. Отвечай ТОЛЬКО на русском языке. Используй предоставленный контекст для ответа. Если контекст не содержит ответа, скажи что информации недостаточно.\n\nКонтекст:\n${context}`,
          },
          { role: "user", content: input },
        ],
        model: this.settings.model,
        url: this.settings.ollamaUrl,
      })

      if (!response.trim()) {
        new Notice("Модель вернула пустой ответ")
        return
      }

      const formatted = formatResponse(response, this.settings.model)
      const insertLine = Math.min(triggerLine + 1, editor.lineCount())
      editor.replaceRange(
        `\n${formatted}\n`,
        { line: insertLine, ch: 0 },
        { line: insertLine, ch: 0 },
      )
      new Notice("✅ Ответ вставлен (прямой поиск)")
    } catch (e) {
      await this.logger.error(`processWithDirectSearch failed: ${toErrorMessage(e)}`)
      new Notice(`❌ Ошибка: ${toErrorMessage(e)}`)
    }
  }

  private async addWithEmbeddings(filePath: string, text: string, pageNum?: number): Promise<void> {
    if (this.settings.embeddingEnabled) {
      try {
        const chunks = semanticChunk(text)
        if (chunks.length > 0) {
          const embeddings = await this.ollama.getEmbeddings({
            model: this.settings.embeddingModel,
            url: this.settings.ollamaUrl,
            input: chunks,
          })
          for (let i = 0; i < chunks.length; i++) {
            this.documentStore.addDocument(filePath, chunks[i], pageNum, embeddings[i])
          }
          return
        }
      } catch (e) {
        await this.logger.warn(`Embeddings failed for ${filePath}, falling back to plain text`, { error: toErrorMessage(e) })
      }
    }
    this.documentStore.addDocument(filePath, text, pageNum)
  }

  private async rewriteQuery(input: string): Promise<string> {
    if (!this.settings.embeddingEnabled) return input
    try {
      const response = await this.ollama.chat({
        model: this.settings.model,
        url: this.settings.ollamaUrl,
        messages: [{
          role: "user",
          content: `Перепиши следующий вопрос для улучшения поиска в научной базе знаний. Добавь релевантные научные термины и синонимы (включая английские, если уместно). Сохрани числовые параметры и ограничения. Верни ТОЛЬКО улучшенный запрос, без пояснений.\n\nИсходный вопрос: ${input}\n\nУлучшенный запрос:`,
        }],
      })
      const trimmed = response.trim()
      return trimmed || input
    } catch {
      return input
    }
  }

  async clearLog(): Promise<void> {
    await this.logger.clear(this.manifest.version)
    await this.logger.info("Log cleared manually")
  }

  private async processDirect(match: TriggerMatch, editor: Editor): Promise<void> {
    const prompt = buildPrompt(match.command, match.input)
    await this.logger.info("processDirect", { trigger: match.command.trigger, input: match.input.slice(0, 100) })
    new Notice(`🤖 ${match.command.trigger}: отправляю запрос...`)

    try {
      const response = await this.ollama.generate({
        prompt,
        model: this.settings.model,
        url: this.settings.ollamaUrl,
      })

      if (!response.trim()) {
        new Notice("Модель вернула пустой ответ")
        return
      }

      const formatted = formatResponse(response, this.settings.model)
      const insertLine = Math.min(match.line + 1, editor.lineCount())
      editor.replaceRange(
        `\n${formatted}\n`,
        { line: insertLine, ch: 0 },
        { line: insertLine, ch: 0 },
      )

      new Notice("✅ Ответ вставлен")
    } catch (e) {
      await this.logger.error(`processDirect failed: ${toErrorMessage(e)}`)
      new Notice(`❌ Ошибка: ${toErrorMessage(e)}`)
    }
  }
}

class FallbackLLMClient implements OllamaClient {
  constructor(
    private _primary: OllamaClient,
    private _secondary: OllamaClient,
    private _primaryModel: string,
    private _secondaryModel: string,
    private _primaryUrl: string,
    private _logger?: import("./types").Logger,
  ) {}

  async generate(opts: import("./types").GenerateOptions): Promise<string> {
    try {
      return await this._primary.generate({ ...opts, model: this._primaryModel })
    } catch (e) {
      if (!this._isRetryable(e)) throw e
      await this._logger?.warn("Primary LLM generate failed, fallback", { error: toErrorMessage(e) })
      return await this._secondary.generate({ ...opts, model: this._secondaryModel })
    }
  }

  async chat(opts: import("./types").ChatOptions): Promise<string> {
    try {
      return await this._primary.chat({ ...opts, model: this._primaryModel })
    } catch (e) {
      if (!this._isRetryable(e)) throw e
      await this._logger?.warn("Primary LLM chat failed, fallback", { error: toErrorMessage(e) })
      return await this._secondary.chat({ ...opts, model: this._secondaryModel })
    }
  }

  async getEmbeddings(opts: import("./types").EmbeddingOptions): Promise<number[][]> {
    try {
      return await this._primary.getEmbeddings(opts)
    } catch (e) {
      if (!this._isRetryable(e)) throw e
      await this._logger?.warn("Primary LLM embeddings failed, fallback", { error: toErrorMessage(e) })
      return await this._secondary.getEmbeddings(opts)
    }
  }

  async listModels(url: string): Promise<string[]> {
    try {
      return await this._primary.listModels(url)
    } catch (e) {
      if (!this._isRetryable(e)) throw e
      await this._logger?.warn("Primary LLM listModels failed, fallback", { error: toErrorMessage(e) })
      return await this._secondary.listModels(url)
    }
  }

  private _isRetryable(err: unknown): boolean {
    if (err instanceof TypeError) return true
    if (err instanceof DOMException && err.name === "AbortError") return true
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes("fetch") || msg.includes("Failed to fetch") || msg.includes("NetworkError")
  }
}
