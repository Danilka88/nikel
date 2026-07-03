import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { FileChanges, IndexManifest, createEmptyManifest } from "../../types"

export class FileWatcher {
  constructor(
    private _nikelDir: string,
  ) {}

  async scan(folderPath: string): Promise<FileChanges> {
    const manifest = await this.loadManifest()
    const previousFiles = manifest.files

    const currentFiles = await this.scanPdfFiles(folderPath)
    const currentHashes: Record<string, string> = {}

    const newFiles: string[] = []
    const changedFiles: string[] = []
    const unchangedFiles: string[] = []

    for (const filePath of currentFiles) {
      const relPath = path.relative(folderPath, filePath)
      const hash = await this.getFileHash(filePath)
      currentHashes[relPath] = hash

      const prevHash = previousFiles[relPath]
      if (prevHash === undefined) {
        newFiles.push(filePath)
      } else if (prevHash !== hash) {
        changedFiles.push(filePath)
      } else {
        unchangedFiles.push(filePath)
      }
    }

    const deletedFiles: string[] = []
    for (const relPath of Object.keys(previousFiles)) {
      if (!currentHashes[relPath]) {
        deletedFiles.push(relPath)
      }
    }

    return { newFiles, changedFiles, deletedFiles, unchangedFiles }
  }

  async loadManifest(): Promise<IndexManifest> {
    try {
      const data = await fs.readFile(this._manifestPath, "utf-8")
      return JSON.parse(data) as IndexManifest
    } catch (err) {
      if (err instanceof SyntaxError) {
        try {
          await fs.copyFile(this._manifestPath, this._manifestPath + ".bak")
        } catch {
          // no original file
        }
      }
      return createEmptyManifest()
    }
  }

  async saveManifest(manifest: IndexManifest): Promise<void> {
    await fs.mkdir(path.dirname(this._manifestPath), { recursive: true })
    const tmpPath = this._manifestPath + ".tmp"
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8")
    await fs.rename(tmpPath, this._manifestPath)
  }

  async updateFileHashes(folderPath: string, files: string[], manifest: IndexManifest): Promise<void> {
    for (const filePath of files) {
      const relPath = path.relative(folderPath, filePath)
      manifest.files[relPath] = await this.getFileHash(filePath)
    }
  }

  async removeFileHashes(files: string[], manifest: IndexManifest): Promise<void> {
    for (const relPath of files) {
      delete manifest.files[relPath]
    }
  }

  async getFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath)
    return crypto.createHash("md5").update(content).digest("hex")
  }

  private get _manifestPath(): string {
    return path.join(this._nikelDir, ".nikel", "file-hashes.json")
  }

  private async scanPdfFiles(folderPath: string): Promise<string[]> {
    const files: string[] = []

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
          files.push(fullPath)
        }
      }
    }

    await walk(folderPath)
    files.sort()
    return files
  }
}
