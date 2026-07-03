import { Modal } from "obsidian"
import type { App } from "obsidian"

export class ProgressModal extends Modal {
  private _progressEl: HTMLElement
  private _labelEl: HTMLElement

  constructor(app: App, title: string) {
    super(app)
    this.titleEl.setText(title)
    this.contentEl.empty()

    this._labelEl = this.contentEl.createEl("p", { text: "Подготовка..." })

    const progressContainer = this.contentEl.createDiv({ cls: "nikel-progress" })
    this._progressEl = progressContainer.createEl("progress", {
      attr: { max: "100", value: "0" },
    })
    this._progressEl.style.width = "100%"
  }

  setProgress(current: number, total: number, label?: string): void {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    this._progressEl.setAttr("value", String(pct))
    this._progressEl.setAttr("max", "100")
    if (label) {
      this._labelEl.setText(label)
    }
  }

  onClose(): void {
    const { contentEl } = this
    contentEl.empty()
  }
}
