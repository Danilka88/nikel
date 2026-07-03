export class Plugin {
  app: any
  manifest: any
  constructor(app?: any, manifest?: any) {
    this.app = app
    this.manifest = manifest
  }
  async loadData(): Promise<any> { return {} }
  async saveData(_: any): Promise<void> {}
  registerEditorSuggest(_: any): void {}
  addCommand(_: any): void {}
  addSettingTab(_: any): void {}
}

export class MarkdownView {
  editor: any
  constructor(editor?: any) {
    this.editor = editor
  }
}

export class PluginSettingTab {
  app: any
  plugin: any
  containerEl: any
  constructor(app: any, plugin: any) {
    this.app = app
    this.plugin = plugin
  }
}

export class Setting {
  constructor(_: any) {}
  setName(_: string) { return this }
  setDesc(_: string) { return this }
  addText(_: (t: any) => void) { return this }
  addTextArea(_: (t: any) => void) { return this }
  addDropdown(_: (d: any) => void) { return this }
  addToggle(_: (t: any) => void) { return this }
  addButton(_: (b: any) => void) { return this }
}

export class Modal {
  app: any
  titleEl: HTMLElement
  contentEl: HTMLElement
  constructor(app: any) {
    this.app = app
    this.titleEl = document.createElement("h2")
    this.contentEl = document.createElement("div")
  }
  open(): void {}
  close(): void {}
}

export class Notice {
  message: string
  static lastMessage: string | null = null
  static calls: string[] = []
  constructor(message: string) {
    this.message = message
    Notice.lastMessage = message
    Notice.calls.push(message)
  }
}

export function addIcon(_id: string, _svg: string): void {}

export class EditorSuggest<T> {
  app: any
  context: any
  constructor(app: any) { this.app = app }
  register(): void {}
  suggestSelected(): void {}
  close(): void {}
}
