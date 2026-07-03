import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"
import { FileWatcher } from "../../../src/services/ingestion/file-watcher"
import { FileChanges } from "../../../src/types"

vi.mock("fs/promises")
vi.mock("crypto", () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue("mockhash"),
  })),
}))

function makeManifest(files: Record<string, string> = {}) {
  return {
    version: 1,
    lastIndexed: "2024-01-01",
    files,
    entities: [],
    relations: [],
  }
}

describe("FileWatcher", () => {
  let watcher: FileWatcher
  const nikelDir = "/test-vault/.nikel"
  const pdfDir = "/test-vault/pdfs"

  beforeEach(() => {
    vi.clearAllMocks()
    watcher = new FileWatcher(nikelDir)
  })

  describe("scan", () => {
    it("detects new files", async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("no file"))
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: "doc1.pdf", isFile: () => true, isDirectory: () => false } as any,
      ])

      const result = await watcher.scan(pdfDir)

      expect(result.newFiles).toHaveLength(1)
      expect(result.unchangedFiles).toHaveLength(0)
      expect(result.changedFiles).toHaveLength(0)
    })

    it("detects unchanged files", async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(makeManifest({ "doc1.pdf": "mockhash", "doc2.pdf": "mockhash" })))
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: "doc1.pdf", isFile: () => true, isDirectory: () => false } as any,
        { name: "doc2.pdf", isFile: () => true, isDirectory: () => false } as any,
      ])

      const result = await watcher.scan(pdfDir)

      expect(result.unchangedFiles).toHaveLength(2)
      expect(result.newFiles).toHaveLength(0)
    })

    it("detects deleted files", async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(makeManifest({ "old.pdf": "hash123" })))
      vi.mocked(fs.readdir).mockResolvedValueOnce([])

      const result = await watcher.scan(pdfDir)

      expect(result.deletedFiles).toEqual(["old.pdf"])
    })

    it("filters out non-PDF files", async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("no file"))
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: "readme.txt", isFile: () => true, isDirectory: () => false } as any,
        { name: "paper.pdf", isFile: () => true, isDirectory: () => false } as any,
      ])

      const result = await watcher.scan(pdfDir)

      expect(result.newFiles).toHaveLength(1)
      expect(result.newFiles[0]).toContain("paper.pdf")
    })
  })

  describe("saveManifest", () => {
    it("writes atomically: tmp then rename", async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined)
      vi.mocked(fs.rename).mockResolvedValueOnce(undefined)

      await watcher.saveManifest(makeManifest() as any)

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.any(String),
        "utf-8",
      )
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.stringContaining("file-hashes.json"),
      )
    })
  })
})
