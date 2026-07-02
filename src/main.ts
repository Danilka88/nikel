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

const NIKEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5"/><text x="50" y="50" text-anchor="middle" dy=".35em" font-size="40" fill="currentColor" font-weight="bold">N</text></svg>`

export default class NikelPlugin extends Plugin {
  settings!: NikelSettings
  suggester!: NikelSuggester
  ollama!: DefaultOllamaClient

  async onload(): Promise<void> {
    await this.loadSettings()
    this.ollama = new DefaultOllamaClient()
    addIcon("nikel", NIKEL_ICON)

    this.suggester = new NikelSuggester(this)
    this.registerEditorSuggest(this.suggester)

    this.addCommand({
      id: "process-nikel-task",
      name: "Process @nikel task",
      icon: "nikel",
      callback: () => this.processNikelTask(),
    })

    this.addSettingTab(new NikelSettingTab(this.app, this))
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
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
