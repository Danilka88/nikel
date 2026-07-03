import {
  Plugin,
  MarkdownView,
  Notice,
  addIcon,
} from "obsidian"
import {
  NikelSettings,
  DEFAULT_SETTINGS,
} from "./types"
import { NikelSuggester } from "./suggester"
import { DefaultOllamaClient } from "./services/ollama"
import { findTrigger, buildPrompt } from "./services/trigger-parser"
import { formatResponse } from "./services/response-formatter"
import { NikelSettingTab } from "./settings/settings-tab"
import { FileWatcher } from "./services/ingestion/file-watcher"
import { KnowledgeGraph } from "./services/graph/knowledge-graph"
import { QueryEngine } from "./services/graph/query-engine"
import { EntityExtractor } from "./services/ingestion/entity-extractor"
import { MdGenerator } from "./services/generation/md-generator"
import { IndexGenerator } from "./services/generation/index-generator"

const NIKEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5"/><text x="50" y="50" text-anchor="middle" dy=".35em" font-size="40" fill="currentColor" font-weight="bold">N</text></svg>`

export default class NikelPlugin extends Plugin {
  settings!: NikelSettings
  suggester!: NikelSuggester
  ollama!: DefaultOllamaClient
  fileWatcher!: FileWatcher
  graph!: KnowledgeGraph
  queryEngine!: QueryEngine
  entityExtractor!: EntityExtractor
  mdGenerator!: MdGenerator
  indexGenerator!: IndexGenerator

  async onload(): Promise<void> {
    await this.loadSettings()
    this.ollama = new DefaultOllamaClient()
    addIcon("nikel", NIKEL_ICON)

    this.initKnowledgeGraphServices()

    this.suggester = new NikelSuggester(this)
    this.registerEditorSuggest(this.suggester)

    this.addCommand({
      id: "process-nikel-task",
      name: "Process @nikel task",
      icon: "nikel",
      callback: () => this.processNikelTask(),
    })

    this.addCommand({
      id: "nikel-index-pdfs",
      name: "Индексировать PDF-папку",
      icon: "nikel",
      callback: () => this.runIndexing(),
    })

    this.addSettingTab(new NikelSettingTab(this.app, this))
  }

  private initKnowledgeGraphServices(): void {
    const vaultDir = (this.app.vault as any).adapter?.basePath || ""
    const nikelDir = vaultDir ? `${vaultDir}/${this.settings.nikelDir}` : this.settings.nikelDir
    const indexManifestPath = `${nikelDir}/.nikel/index.json`

    this.fileWatcher = new FileWatcher(nikelDir)
    this.graph = new KnowledgeGraph(indexManifestPath)
    this.entityExtractor = new EntityExtractor(this.ollama, {
      model: this.settings.model,
      url: this.settings.ollamaUrl,
    })
    this.queryEngine = new QueryEngine(this.graph, this.ollama, {
      model: this.settings.model,
      url: this.settings.ollamaUrl,
    })
    this.mdGenerator = new MdGenerator(nikelDir)
    this.indexGenerator = new IndexGenerator()
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  async runIndexing(): Promise<void> {
    if (!this.settings.pdfFolder) {
      new Notice("Укажите папку с PDF в настройках Nikel")
      return
    }

    new Notice("🔍 Сканирую PDF-папку...")

    try {
      const changes = await this.fileWatcher.scan(this.settings.pdfFolder)
      const totalChanges = changes.newFiles.length + changes.changedFiles.length + changes.deletedFiles.length

      if (totalChanges === 0) {
        new Notice("✅ Изменений не найдено. Все PDF актуальны.")
        return
      }

      new Notice(`📄 Найдено изменений: ${changes.newFiles.length} новых, ${changes.changedFiles.length} изменённых, ${changes.deletedFiles.length} удалённых`)

      await this.graph.load()

      const processedFiles = [...changes.newFiles, ...changes.changedFiles]
      let processedCount = 0

      for (const filePath of processedFiles) {
        new Notice(`📄 Обрабатываю: ${filePath.split("/").pop()} (${processedCount + 1}/${processedFiles.length})`)
        processedCount++
      }

      await this.fileWatcher.updateFileHashes(this.settings.pdfFolder, processedFiles, this.graph.manifest)
      await this.fileWatcher.removeFileHashes(changes.deletedFiles, this.graph.manifest)

      this.graph.manifest.lastIndexed = new Date().toISOString()
      await this.graph.save()

      const stats = this.graph.getStats()
      new Notice(`✅ Индексация завершена. Сущностей: ${stats.entityCount}, связей: ${stats.relationCount}`)
    } catch (e) {
      new Notice(`❌ Ошибка индексации: ${(e as Error).message}`)
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

    const isGraphMode = this.settings.pdfFolder && this.graph.entities.length > 0

    if (isGraphMode) {
      await this.processWithGraph(match.input, match.line, editor)
    } else {
      await this.processDirect(match, editor)
    }
  }

  private async processWithGraph(
    input: string,
    triggerLine: number,
    editor: any,
  ): Promise<void> {
    new Notice("🔍 Ищу в базе знаний...")

    try {
      const result = await this.queryEngine.answerQuestion(input)

      const doc = this.mdGenerator.generateAnswerDoc(result, input, this.settings.model)

      const insertLine = triggerLine + 1
      const content = `\n> **Контекст из базы знаний:**\n${result.contextMd.split("\n").map((l) => `> ${l}`).join("\n")}\n>\n> **Ответ:**\n> ${result.answer.split("\n").join("\n> ")}\n`

      editor.replaceRange(
        content,
        { line: insertLine, ch: 0 },
        { line: insertLine, ch: 0 },
      )

      new Notice("✅ Ответ из базы знаний вставлен")
    } catch (e) {
      new Notice(`❌ Ошибка: ${(e as Error).message}`)
    }
  }

  private async processDirect(match: any, editor: any): Promise<void> {
    const prompt = buildPrompt(match.command, match.input)
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
      new Notice(`❌ Ошибка Ollama: ${(e as Error).message}`)
    }
  }
}
