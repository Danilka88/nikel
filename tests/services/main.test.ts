import { describe, it, expect, vi, beforeEach } from "vitest"
import NikelPlugin from "../../src/main"
import { Notice } from "../__mocks__/obsidian"

describe("NikelPlugin", () => {
  let plugin: NikelPlugin
  let mockEditor: any

  beforeEach(async () => {
    vi.clearAllMocks()
    Notice.lastMessage = null
    Notice.calls = []

    plugin = new NikelPlugin({} as any, {} as any)

    vi.spyOn(plugin, "loadSettings").mockImplementation(async () => {
      plugin.settings = {
        ollamaUrl: "http://localhost:11434",
        model: "gemma4:e4b",
        pdfFolder: "",
        txtFolder: "",
        docxFolder: "",
        nikelDir: "nikel",
        indexingMode: "vision",
        embeddingModel: "nomic-embed-text",
        embeddingEnabled: false,
        provider: "ollama",
        yandexFolderId: "",
        yandexModel: "yandexgpt/latest",
        commands: [
          {
            trigger: "@nikel_s",
            description: "Send task",
            promptTemplate: "You are a helper.\n\n{{input}}",
            enabled: true,
          },
        ],
      }
    })

    plugin.textExtractor = {
      extractTxt: vi.fn().mockResolvedValue({ markdown: "text", pageCount: 1, pages: ["text"] }),
      extractDocx: vi.fn().mockResolvedValue({ markdown: "docx", pageCount: 1, pages: ["docx"] }),
    } as any

    plugin.ollama = {
      generate: vi.fn().mockResolvedValue("Hello! This is a response."),
      chat: vi.fn().mockResolvedValue("Hello! This is a response."),
      getEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      listModels: vi.fn().mockResolvedValue(["gemma4:e4b"]),
    } as any

    plugin.logger = {
      info: vi.fn().mockResolvedValue(undefined),
      warn: vi.fn().mockResolvedValue(undefined),
      error: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getLogContent: vi.fn().mockResolvedValue(""),
      checkVersion: vi.fn().mockResolvedValue(undefined),
    } as any

    await plugin.loadSettings()
  })

  function mockActiveView(editor: any) {
    plugin.app.workspace = {
      getActiveViewOfType: vi.fn(() => ({ editor })),
    } as any
  }

  function createMockEditor(lines: string[], cursorLine = 0) {
    return {
      getLine: vi.fn((i: number) => lines[i] ?? ""),
      lineCount: vi.fn(() => lines.length),
      getCursor: vi.fn(() => ({ line: cursorLine, ch: 0 })),
      replaceRange: vi.fn(),
    }
  }

  it("shows notice when no editor is open", async () => {
    plugin.app.workspace = {
      getActiveViewOfType: vi.fn(() => null),
    } as any

    await plugin.processNikelTask()
    expect(Notice.lastMessage).toBe("Откройте редактор заметок")
  })

  it("shows notice when no trigger is found", async () => {
    const editor = createMockEditor([
      "just some normal text",
      "nothing special here",
    ], 1)
    mockActiveView(editor)

    await plugin.processNikelTask()
    expect(Notice.lastMessage).toContain("Не найден")
  })

  it("shows notice when trigger has no input text", async () => {
    const editor = createMockEditor(["@nikel_s   "], 0)
    mockActiveView(editor)

    await plugin.processNikelTask()
    expect(Notice.lastMessage).toContain("Нет текста")
  })

  it("processes trigger, calls ollama, and inserts response", async () => {
    const replaceRange = vi.fn()
    const editor = {
      getLine: vi.fn((i: number) => i === 0 ? "@nikel_s explain DI" : ""),
      lineCount: vi.fn(() => 1),
      getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
      replaceRange,
    }
    mockActiveView(editor)

    await plugin.processNikelTask()

    expect(plugin.ollama.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("explain DI"),
        model: "gemma4:e4b",
        url: "http://localhost:11434",
      }),
    )

    expect(replaceRange).toHaveBeenCalledOnce()
    const [text, from] = replaceRange.mock.calls[0]
    expect(from.line).toBe(1)
    expect(text).toContain("> **Nikel (gemma4:e4b):**")
    expect(text).toContain("Hello! This is a response.")
  })

  it("shows notice when ollama returns empty response", async () => {
    plugin.ollama.generate = vi.fn().mockResolvedValue("")

    const editor = createMockEditor(["@nikel_s hello"], 0)
    mockActiveView(editor)

    await plugin.processNikelTask()

    expect(Notice.lastMessage).toBe("Модель вернула пустой ответ")
  })

  it("shows notice on ollama error", async () => {
    plugin.ollama.generate = vi.fn().mockRejectedValue(
      new Error("Connection refused"),
    )

    const editor = createMockEditor(["@nikel_s hello"], 0)
    mockActiveView(editor)

    await plugin.processNikelTask()

    expect(Notice.lastMessage).toBe("❌ Ошибка: Connection refused")
  })

  it("scans upward from cursor to find trigger", async () => {
    const replaceRange = vi.fn()
    const editor = {
      getLine: vi.fn((i: number) => {
        if (i === 0) return "@nikel_s do something"
        return "cursor is down here"
      }),
      lineCount: vi.fn(() => 2),
      getCursor: vi.fn(() => ({ line: 1, ch: 0 })),
      replaceRange,
    }
    mockActiveView(editor)

    await plugin.processNikelTask()

    expect(plugin.ollama.generate).toHaveBeenCalled()
    expect(replaceRange).toHaveBeenCalled()
    expect(replaceRange.mock.calls[0][1].line).toBe(1)
  })

  describe("graph mode", () => {
    beforeEach(() => {
      plugin.settings.pdfFolder = "/some/pdf/folder"
      plugin.graph = {
        load: vi.fn().mockResolvedValue(undefined),
        entities: [{ id: "1", type: "material", name: "Lithium", aliases: ["Li"] }],
      } as any
      plugin.queryEngine = {
        answerQuestion: vi.fn().mockResolvedValue({
          answer: "Lithium is used in batteries.",
          contextMd: "- [[materials/Lithium.md|Lithium]]\n- [[materials/Cobalt.md|Cobalt]]",
          linkedDocs: ["materials/Lithium.md", "materials/Cobalt.md"],
        }),
      } as any
      plugin.mdGenerator = {
        generateAnswerDoc: vi.fn().mockReturnValue({
          path: "nikel/_answers/2026-07-03-143000.md",
          content: "# Answer\n\nLithium is key.\n",
        }),
      } as any
      plugin.app.vault = {
        adapter: { basePath: "/vault" },
        create: vi.fn().mockResolvedValue({}),
        createFolder: vi.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
      } as any
    })

    it("calls processWithGraph when graph has entities", async () => {
      const replaceRange = vi.fn()
      const editor = {
        getLine: vi.fn((i: number) => i === 0 ? "@nikel_s lithium battery" : ""),
        lineCount: vi.fn(() => 1),
        getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
        replaceRange,
      }
      mockActiveView(editor)

      await plugin.processNikelTask()

      expect(plugin.queryEngine.answerQuestion).toHaveBeenCalledWith("lithium battery")
      expect(replaceRange).toHaveBeenCalled()
      const [text, from] = replaceRange.mock.calls[0]
      expect(text).toContain("Ответ сохранён")
      expect(text).toContain("nikel/_answers/2026-07-03-143000.md")
      expect(from.line).toBe(1)
    })

    it("shows notice on graph mode query error", async () => {
      plugin.queryEngine.answerQuestion = vi.fn().mockRejectedValue(
        new Error("Graph search failed"),
      )

      const editor = createMockEditor(["@nikel_s lithium"], 0)
      mockActiveView(editor)

      await plugin.processNikelTask()

      expect(Notice.lastMessage).toContain("Graph search failed")
    })
  })

  describe("direct mode", () => {
    beforeEach(() => {
      plugin.settings.indexingMode = "direct"
      plugin.settings.pdfFolder = "/some/pdf/folder"
      plugin.documentStore = {
        search: vi.fn(),
      } as any
      plugin.ollama.chat = vi.fn().mockResolvedValue("Based on the documents, lithium is used in batteries.")
    })

    it("calls processWithDirectSearch when direct mode and source exists", async () => {
      plugin.documentStore.search = vi.fn().mockReturnValue([
        { sourcePath: "/path/doc1.pdf", pageNum: 1, chunkIndex: 0, text: "lithium ion battery" },
      ])

      const editor = createMockEditor(["@nikel_s lithium battery"], 0)
      mockActiveView(editor)

      await plugin.processNikelTask()

      expect(plugin.documentStore.search).toHaveBeenCalledWith("lithium battery", 5, undefined)
      expect(plugin.ollama.chat).toHaveBeenCalled()
      expect(editor.replaceRange).toHaveBeenCalled()
    })

    it("shows notice when no chunks found in direct search", async () => {
      plugin.documentStore.search = vi.fn().mockReturnValue([])

      const editor = createMockEditor(["@nikel_s something"], 0)
      mockActiveView(editor)

      await plugin.processNikelTask()

      expect(Notice.lastMessage).toBe("Ничего не найдено в индексе")
    })
  })
})
