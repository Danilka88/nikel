import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { FileChanges, IndexManifest, createEmptyManifest } from "../../types"

const DEFAULT_EXTENSIONS = [".pdf"]

export class FileWatcher {
  constructor(
    private _nikelDir: string,
  ) {}

  async scan(folderPath: string, extensions: string[] = DEFAULT_EXTENSIONS): Promise<FileChanges> {
    const manifest = await this.loadAndMigrateManifest()
    const previousFiles = manifest.files

    const currentFiles = await this.scanFiles(folderPath, extensions)
    const currentKeys = new Set<string>()

    const newFiles: string[] = []
    const changedFiles: string[] = []
    const unchangedFiles: string[] = []

    for (const filePath of currentFiles) {
      const key = path.resolve(filePath)
      currentKeys.add(key)

      let hash: string
      try {
        hash = await this.getFileHash(filePath)
      } catch {
        continue
      }

      const prevHash = previousFiles[key]
      if (prevHash === undefined) {
        newFiles.push(filePath)
      } else if (prevHash !== hash) {
        changedFiles.push(filePath)
      } else {
        unchangedFiles.push(filePath)
      }
    }

    const currentExts = new Set(extensions.map((e) => e.toLowerCase()))
    const deletedFiles: string[] = []
    for (const key of Object.keys(previousFiles)) {
      if (!currentKeys.has(key)) {
        const keyExt = path.extname(key).toLowerCase()
        if (currentExts.has(keyExt)) {
          deletedFiles.push(key)
        }
      }
    }

    return { newFiles, changedFiles, deletedFiles, unchangedFiles }
  }

  async updateFileHashes(files: string[], manifest: IndexManifest): Promise<void> {
    for (const filePath of files) {
      manifest.files[path.resolve(filePath)] = await this.getFileHash(filePath)
    }
  }

  async removeFileHashes(fileKeys: string[], manifest: IndexManifest): Promise<void> {
    for (const key of fileKeys) {
      delete manifest.files[key]
    }
  }

  async getFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath)
    return crypto.createHash("md5").update(content).digest("hex")
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
          // no original file to backup
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

  private async loadAndMigrateManifest(): Promise<IndexManifest> {
    const manifest = await this.loadManifest()
    const files = manifest.files
    const migrated: Record<string, string> = {}

    for (const [key, hash] of Object.entries(files)) {
      if (path.isAbsolute(key)) {
        migrated[key] = hash
      } else {
        const absPath = path.resolve(this._nikelDir, "..", key)
        try {
          await fs.access(absPath)
          migrated[absPath] = hash
        } catch {
          migrated[key] = hash
        }
      }
    }

    manifest.files = migrated
    return manifest
  }

  private get _manifestPath(): string {
    return path.join(this._nikelDir, ".nikel", "file-hashes.json")
  }

  private async scanFiles(folderPath: string, extensions: string[]): Promise<string[]> {
    const files: string[] = []
    const lowerExts = extensions.map((e) => e.toLowerCase())

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase()
          if (lowerExts.some((ext) => name.endsWith(ext))) {
            files.push(fullPath)
          }
        }
      }
    }

    await walk(folderPath)
    files.sort()
    return files
  }
}
