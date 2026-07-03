import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
} from "obsidian"
import type NikelPlugin from "../main"

export class NikelSettingTab extends PluginSettingTab {
  plugin: NikelPlugin
  modelOptions: string[]

  constructor(app: App, plugin: NikelPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.modelOptions = [plugin.settings.model]
  }

  async loadModels(): Promise<void> {
    try {
      this.modelOptions = await this.plugin.ollama.listModels(this.plugin.settings.ollamaUrl)
    } catch {
      this.modelOptions = [this.plugin.settings.model]
    }
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl("h2", { text: "Nikel — настройки" })

    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc("Адрес Ollama сервера (по умолчанию http://localhost:11434)")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaUrl = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Модель")
      .setDesc("Выберите модель Ollama")
      .addDropdown((dropdown) => {
        this.modelOptions.forEach((m) => dropdown.addOption(m, m))
        dropdown.setValue(this.plugin.settings.model)
        dropdown.onChange(async (value) => {
          this.plugin.settings.model = value
          await this.plugin.saveSettings()
        })
      })

    new Setting(containerEl)
      .setName("Обновить список моделей")
      .setDesc("Запросить список доступных моделей из Ollama")
      .addButton((btn) =>
        btn.setButtonText("Обновить").onClick(async () => {
          try {
            this.modelOptions = await this.plugin.ollama.listModels(this.plugin.settings.ollamaUrl)
            this.display()
            new Notice("Список моделей обновлён")
          } catch (e) {
            new Notice(`Ошибка: ${(e as Error).message}`)
          }
        }),
      )

    new Setting(containerEl)
      .setName("Проверить подключение")
      .setDesc("Проверить доступность Ollama по указанному URL")
      .addButton((btn) =>
        btn.setButtonText("Тест").onClick(async () => {
          try {
            const models = await this.plugin.ollama.listModels(this.plugin.settings.ollamaUrl)
            const names = models.length > 0 ? models.join(", ") : "не найдены"
            new Notice(`✅ Подключено. Модели: ${names}`)
          } catch (e) {
            new Notice(`❌ Ошибка: ${(e as Error).message}`)
          }
        }),
      )

    containerEl.createEl("h3", { text: "Knowledge Graph" })

    new Setting(containerEl)
      .setName("PDF-папка")
      .setDesc("Путь к папке с PDF-файлами для индексации")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/pdfs")
          .setValue(this.plugin.settings.pdfFolder)
          .onChange(async (value) => {
            this.plugin.settings.pdfFolder = value
            await this.plugin.saveSettings()
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Обзор").onClick(() => {
          const input = document.createElement("input")
          input.type = "file"
          input.setAttribute("webkitdirectory", "")
          input.setAttribute("directory", "")
          input.style.display = "none"

          input.addEventListener("change", () => {
            if (input.files && input.files.length > 0) {
              const file = input.files[0] as any
              const relPath: string = file.webkitRelativePath || ""
              const fullPath: string = file.path || ""
              let folderPath: string
              if (relPath && fullPath) {
                folderPath = fullPath.slice(0, -relPath.length - 1)
              } else if (fullPath) {
                folderPath = fullPath.replace(/\/[^/]+$/, "")
              } else {
                new Notice("Не удалось определить путь к папке")
                document.body.removeChild(input)
                return
              }
              this.plugin.settings.pdfFolder = folderPath
              this.plugin.saveSettings()
              this.display()
            }
            document.body.removeChild(input)
          })

          document.body.appendChild(input)
          input.click()
        }),
      )

    new Setting(containerEl)
      .setName("Папка генерации")
      .setDesc("Куда сохранять сгенерированные документы (относительно хранилища)")
      .addText((text) =>
        text
          .setPlaceholder("nikel")
          .setValue(this.plugin.settings.nikelDir)
          .onChange(async (value) => {
            this.plugin.settings.nikelDir = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Индексировать PDF")
      .setDesc("Запустить индексацию PDF-файлов")
      .addButton((btn) =>
        btn.setButtonText("Старт").onClick(async () => {
          await this.plugin.runIndexing()
        }),
      )

    new Setting(containerEl)
      .setName("Режим индексации")
      .setDesc("Полный — Vision LLM на каждую страницу (медленно, для сканов). Быстрый — извлечение текста pdfjs (мгновенно, только для текстовых PDF)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vision", "Полный (Vision LLM)")
          .addOption("fast", "Быстрый (извлечение текста)")
          .setValue(this.plugin.settings.indexingMode)
          .onChange(async (value) => {
            this.plugin.settings.indexingMode = value as "vision" | "fast"
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Статус базы знаний")
      .setDesc("Количество сущностей и связей в графе")
      .addButton((btn) =>
        btn.setButtonText("Статус").onClick(async () => {
          const stats = this.plugin.graph.getStats()
          new Notice(`📊 Сущностей: ${stats.entityCount}, связей: ${stats.relationCount}, источников: ${stats.fileCount}`)
        }),
      )

    containerEl.createEl("hr")
    containerEl.createEl("h3", { text: "Логирование" })

    new Setting(containerEl)
      .setName("Экспорт лога")
      .setDesc("Создать заметку с логом для отправки AI-ассистенту")
      .addButton((btn) =>
        btn.setButtonText("📋 Создать отчёт").onClick(async () => {
          const path = await this.plugin.exportLog()
          if (path) {
            new Notice(`✅ Лог сохранён: ${path}`)
          } else {
            new Notice("Лог пуст")
          }
        }),
      )

    new Setting(containerEl)
      .setName("Очистить лог")
      .setDesc("Удалить все записи лога")
      .addButton((btn) =>
        btn.setButtonText("🗑 Очистить").onClick(async () => {
          await this.plugin.clearLog()
          new Notice("Лог очищен")
        }),
      )

    containerEl.createEl("hr")
    containerEl.createEl("h3", { text: "Команды (@nikel_*)" })

    this.plugin.settings.commands.forEach((cmd, index) => {
      containerEl.createEl("div", { cls: "nikel-command-header" })
        .createEl("h4", { text: `/${cmd.trigger}` })

      new Setting(containerEl)
        .setName("Триггер")
        .setDesc("Строка-триггер (например @nikel_s)")
        .addText((text) =>
          text
            .setPlaceholder("@nikel_s")
            .setValue(cmd.trigger)
            .onChange(async (value) => {
              this.plugin.settings.commands[index].trigger = value
              await this.plugin.saveSettings()
            }),
        )

      new Setting(containerEl)
        .setName("Описание")
        .setDesc("Отображается в автокомплите")
        .addText((text) =>
          text
            .setPlaceholder("Описание команды")
            .setValue(cmd.description)
            .onChange(async (value) => {
              this.plugin.settings.commands[index].description = value
              await this.plugin.saveSettings()
            }),
        )

      new Setting(containerEl)
        .setName("Промпт")
        .setDesc('Шаблон промпта. {{input}} заменяется на текст пользователя')
        .addTextArea((text) =>
          text
            .setPlaceholder("You are a helpful assistant...\n\n{{input}}")
            .setValue(cmd.promptTemplate)
            .onChange(async (value) => {
              this.plugin.settings.commands[index].promptTemplate = value
              await this.plugin.saveSettings()
            }),
        )

      new Setting(containerEl)
        .setName("Включена")
        .setDesc("Показывать в автокомплите и разрешить обработку")
        .addToggle((toggle) =>
          toggle
            .setValue(cmd.enabled)
            .onChange(async (value) => {
              this.plugin.settings.commands[index].enabled = value
              await this.plugin.saveSettings()
              this.display()
            }),
        )

      new Setting(containerEl)
        .addButton((btn) =>
          btn.setButtonText("Удалить команду").onClick(async () => {
            this.plugin.settings.commands.splice(index, 1)
            await this.plugin.saveSettings()
            this.display()
          }),
        )

      containerEl.createEl("hr")
    })

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Добавить команду").onClick(async () => {
        this.plugin.settings.commands.push({
          trigger: "@nikel_new",
          description: "Новая команда",
          promptTemplate: "{{input}}",
          enabled: true,
        })
        await this.plugin.saveSettings()
        this.display()
      }),
    )
  }
}
