import * as path from "path"
import * as fs from "fs/promises"
import {
  Plugin,
  MarkdownView,
  Notice,
  addIcon,
  TFile,
} from "obsidian"
import {
  NikelSettings,
  DEFAULT_SETTINGS,
} from "./types"
import { detectSourceType } from "./utils"
import { NikelSuggester } from "./suggester"
import { DefaultOllamaClient } from "./services/ollama"
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
  ollama!: DefaultOllamaClient
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

  async onload(): Promise<void> {
    await this.loadSettings()
    this.ollama = new DefaultOllamaClient()
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
        indexingMode: this.settings.indexingMode === "direct" ? "fast" : this.settings.indexingMode,
      },
      this.logger,
    )
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  async runIndexing(): Promise<void> {
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

      for (const f of folders) {
        const changes = await this.fileWatcher.scan(f.path, f.exts)
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
      }

      const processedFiles = [...allNew, ...allChanged]
      const totalFiles = processedFiles.length

      for (let i = 0; i < totalFiles; i++) {
        const filePath = processedFiles[i]
        const fileName = filePath.split("/").pop() || filePath
        modal.setProgress(i + 1, totalFiles, `Обрабатываю: ${fileName}`)

        await this.logger.info(`Processing: ${fileName}`, { file: filePath, index: String(i + 1), total: String(totalFiles) })

        const raw = await fs.readFile(filePath)
        const data = Uint8Array.from(raw)
        const ext = path.extname(filePath).toLowerCase()

        try {
          let extractResult: import("./types").PdfExtractResult

          if (ext === ".pdf") {
            const pdfMode = this.settings.indexingMode === "direct" ? "fast" : this.settings.indexingMode
            extractResult = await this.pdfExtractor.extractPdf(data, pdfMode)
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
                this.documentStore.addDocument(filePath, extractResult.pages[p], p + 1)
              }
            } else {
              this.documentStore.addDocument(filePath, extractResult.markdown)
            }
          } else {
            const result = await this.entityExtractor.extract(
              extractResult.markdown,
              filePath,
            )

            const relPath = path.relative(folders[0].path, filePath)
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
        } catch (fileErr) {
          await this.logger.error(`Failed to process ${fileName}: ${(fileErr as Error).message}`, { file: fileName })
          new Notice(`⚠️ Ошибка при обработке ${fileName}: ${(fileErr as Error).message}`)
        }
      }

      if (this.settings.indexingMode === "direct") {
        await this.documentStore.save()

        const hashManifest = await this.fileWatcher.loadManifest()
        hashManifest.lastIndexed = new Date().toISOString()
        await this.fileWatcher.updateFileHashes(processedFiles, hashManifest)
        await this.fileWatcher.removeFileHashes(allDeleted, hashManifest)
        await this.fileWatcher.saveManifest(hashManifest)

        modal.setProgress(100, 100, "Сохранение завершено")
        modal.close()
        const ds = this.documentStore.stats
        await this.logger.info(`Direct indexing complete: ${ds.totalChunks} chunks from ${ds.totalSources} sources`)
        new Notice(`✅ Индексация завершена. ${ds.totalChunks} текстовых блоков из ${ds.totalSources} файлов.`)
      } else {
        await this.fileWatcher.updateFileHashes(processedFiles, this.graph.manifest)
        await this.fileWatcher.removeFileHashes(allDeleted, this.graph.manifest)

        this.graph.manifest.lastIndexed = new Date().toISOString()
        await this.graph.save()
        await this.fileWatcher.saveManifest(this.graph.manifest)

        const vaultBase = this.vaultBasePath
        let generatedCount = 0
        for (const entity of this.graph.entities) {
          const doc = this.mdGenerator.generateDoc(entity, this.graph.relations)
          const vaultRelPath = doc.path.startsWith(vaultBase)
            ? doc.path.slice(vaultBase.length + 1)
            : `${this.settings.nikelDir}/_answers/${doc.path.split("/").pop()}`
          const exists = this.app.vault.getAbstractFileByPath(vaultRelPath)
          if (!exists) {
            try {
              await this.app.vault.create(vaultRelPath, doc.content)
              generatedCount++
            } catch {
              // path may already exist from a previous run
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
      const msg = (e as Error).message
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
      // fallback: write directly via fs
      await fs.writeFile(exportPath, mdContent, "utf-8")
    }
    return vaultRelPath
  }

  private async processWithGraph(
    input: string,
    triggerLine: number,
    editor: any,
  ): Promise<void> {
    await this.logger.info("processWithGraph", { input: input.slice(0, 100) })
    new Notice("🔍 Ищу в базе знаний...")

    try {
      const result = await this.queryEngine.answerQuestion(input)

      const doc = this.mdGenerator.generateAnswerDoc(result, input, this.settings.model)

      const vaultBase = this.vaultBasePath
      const vaultRelPath = doc.path.startsWith(vaultBase)
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
      } catch {
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
      await this.logger.error(`processWithGraph failed: ${(e as Error).message}`)
      new Notice(`❌ Ошибка: ${(e as Error).message}`)
    }
  }

  private async processWithDirectSearch(
    input: string,
    triggerLine: number,
    editor: any,
  ): Promise<void> {
    await this.logger.info("processWithDirectSearch", { input: input.slice(0, 100) })
    new Notice("🔍 Ищу в текстовом индексе...")

    try {
      const chunks = this.documentStore.search(input, 5)

      if (chunks.length === 0) {
        new Notice("Ничего не найдено в индексе")
        return
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
      await this.logger.error(`processWithDirectSearch failed: ${(e as Error).message}`)
      new Notice(`❌ Ошибка: ${(e as Error).message}`)
    }
  }

  async clearLog(): Promise<void> {
    await this.logger.clear(this.manifest.version)
    await this.logger.info("Log cleared manually")
  }

  private async processDirect(match: any, editor: any): Promise<void> {
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
      const insertLine = match.line + 1
      editor.replaceRange(
        `\n${formatted}\n`,
        { line: insertLine, ch: 0 },
        { line: insertLine, ch: 0 },
      )

      new Notice("✅ Ответ вставлен")
    } catch (e) {
      await this.logger.error(`processDirect failed: ${(e as Error).message}`)
      new Notice(`❌ Ошибка Ollama: ${(e as Error).message}`)
    }
  }
}
