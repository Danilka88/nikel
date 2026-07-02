import { describe, it, expect, vi } from "vitest"
import { NikelSuggester } from "../../src/suggester"
import { NikelSettings, DEFAULT_SETTINGS } from "../../src/types"

function createMockPlugin(commands = DEFAULT_SETTINGS.commands) {
  const settings: NikelSettings = {
    ollamaUrl: "http://localhost:11434",
    model: "gemma4:e4b",
    commands,
  }
  return {
    app: {},
    settings,
  }
}

describe("NikelSuggester", () => {
  describe("onTrigger", () => {
    it("returns trigger info when typing @nik at word start", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const editor = {
        getLine: () => "@nik something",
      }

      const result = (suggester as any).onTrigger(
        { line: 0, ch: 4 },
        editor as any,
        null,
      )

      expect(result).not.toBeNull()
      expect(result.start.ch).toBe(0)
      expect(result.end.ch).toBe(4)
      expect(result.query).toBe("@nik")
    })

    it("returns null when no @nik prefix", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const editor = {
        getLine: () => "just text",
      }

      const result = (suggester as any).onTrigger(
        { line: 0, ch: 5 },
        editor as any,
        null,
      )

      expect(result).toBeNull()
    })

    it("matches @nikel_s partially when @nik typed", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const editor = {
        getLine: () => "@nikel_s test",
      }

      const result = (suggester as any).onTrigger(
        { line: 0, ch: 8 },
        editor as any,
        null,
      )

      expect(result).not.toBeNull()
      expect(result.query).toBe("@nikel_s")
    })
  })

  describe("getSuggestions", () => {
    it("returns enabled commands matching query", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const suggestions = (suggester as any).getSuggestions({
        query: "@nikel_s",
      })

      expect(suggestions.length).toBeGreaterThanOrEqual(1)
      expect(suggestions[0].trigger).toBe("@nikel_s")
    })

    it("filters commands by partial query match", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const suggestions = (suggester as any).getSuggestions({
        query: "_f",
      })

      expect(suggestions.length).toBe(1)
      expect(suggestions[0].trigger).toBe("@nikel_f")
    })

    it("excludes disabled commands", () => {
      const commands = [
        {
          trigger: "@nikel_s",
          description: "Test",
          promptTemplate: "{{input}}",
          enabled: true,
        },
        {
          trigger: "@nikel_disabled",
          description: "Disabled",
          promptTemplate: "{{input}}",
          enabled: false,
        },
      ]
      const plugin = createMockPlugin(commands)
      const suggester = new NikelSuggester(plugin as any)

      const suggestions = (suggester as any).getSuggestions({
        query: "@nikel",
      })

      expect(suggestions.length).toBe(1)
      expect(suggestions[0].trigger).toBe("@nikel_s")
    })

    it("returns empty list when nothing matches", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const suggestions = (suggester as any).getSuggestions({
        query: "zzz",
      })

      expect(suggestions).toHaveLength(0)
    })
  })

  describe("renderSuggestion", () => {
    it("renders trigger and description elements", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const el = {
        createEl: vi.fn((tag: string, opts?: any) => ({
          createSpan: vi.fn(),
        })),
        createSpan: vi.fn(),
      }

      ;(suggester as any).renderSuggestion(
        { trigger: "@nikel_s", description: "Test" },
        el as any,
      )

      expect(el.createEl).toHaveBeenCalledWith("strong", { text: "@nikel_s" })
    })
  })

  describe("selectSuggestion", () => {
    it("replaces the trigger text and moves cursor", () => {
      const plugin = createMockPlugin()
      const suggester = new NikelSuggester(plugin as any)

      const editor = {
        replaceRange: vi.fn(),
        setCursor: vi.fn(),
      }

      suggester.context = {
        editor: editor as any,
        start: { line: 0, ch: 0 },
        end: { line: 0, ch: 4 },
      } as any

      ;(suggester as any).selectSuggestion(
        { trigger: "@nikel_s", description: "Test" },
        {} as any,
      )

      expect(editor.replaceRange).toHaveBeenCalledWith(
        "@nikel_s ",
        { line: 0, ch: 0 },
        { line: 0, ch: 4 },
      )
      expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 9 })
    })
  })
})
