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
