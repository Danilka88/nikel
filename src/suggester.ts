import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian"
import NikelPlugin from "./main"

interface NikelSuggestEntry {
  trigger: string
  description: string
}

export class NikelSuggester extends EditorSuggest<NikelSuggestEntry> {
  plugin: NikelPlugin

  constructor(plugin: NikelPlugin) {
    super(plugin.app)
    this.plugin = plugin
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile
  ): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line)
    const lineUpToCursor = line.slice(0, cursor.ch)

    const match = lineUpToCursor.match(/(@nik[^ ]*)$/)
    if (!match) return null

    return {
      start: { line: cursor.line, ch: match.index! },
      end: cursor,
      query: match[1],
    }
  }

  getSuggestions(context: EditorSuggestContext): NikelSuggestEntry[] {
    const query = context.query.toLowerCase()
    return this.plugin.settings.commands
      .filter((cmd) => cmd.enabled)
      .filter((cmd) => cmd.trigger.toLowerCase().includes(query))
      .map((cmd) => ({
        trigger: cmd.trigger,
        description: cmd.description,
      }))
  }

  renderSuggestion(entry: NikelSuggestEntry, el: HTMLElement): void {
    el.createEl("strong", { text: entry.trigger })
    el.createSpan({ text: `  —  ${entry.description}`, cls: "nikel-suggest-desc" })
  }

  selectSuggestion(entry: NikelSuggestEntry, evt: MouseEvent | KeyboardEvent): void {
    if (!this.context) return

    const editor = this.context.editor
    const { start, end } = this.context

    editor.replaceRange(entry.trigger + " ", start, end)
    editor.setCursor({ line: start.line, ch: start.ch + entry.trigger.length + 1 })
    this.close()
  }
}
