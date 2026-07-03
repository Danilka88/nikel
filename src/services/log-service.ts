import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "../types"

const MAX_LINES = 500

export class FileLogger implements Logger {
  private _logPath: string
  private _buffer: string[] = []
  private _pluginVersion = ""

  constructor(logDir: string) {
    const nikeldir = path.join(logDir, ".nikel")
    this._logPath = path.join(nikeldir, "nikel.log")
  }

  async info(msg: string, context?: Record<string, string>): Promise<void> {
    await this._append("INFO", msg, context)
  }

  async warn(msg: string, context?: Record<string, string>): Promise<void> {
    await this._append("WARN", msg, context)
  }

  async error(msg: string, context?: Record<string, string>): Promise<void> {
    await this._append("ERROR", msg, context)
  }

  async clear(pluginVersion?: string): Promise<void> {
    this._buffer = []
    this._pluginVersion = pluginVersion || ""
    const header = `# Nikel Log / plugin: ${this._pluginVersion || "unknown"} / maxLines: ${MAX_LINES}`
    this._buffer.push(header)
    try {
      await fs.mkdir(path.dirname(this._logPath), { recursive: true })
      await fs.writeFile(this._logPath, header + "\n", "utf-8")
    } catch {
      // Log file is non-critical, silently ignore write errors
    }
  }

  async getLogContent(): Promise<string> {
    if (this._buffer.length === 0) return ""
    return this._buffer.join("\n")
  }

  async checkVersion(pluginVersion: string): Promise<boolean> {
    try {
      const firstLine = await fs.readFile(this._logPath, "utf-8").then(
        (c) => c.split("\n")[0],
        () => "",
      )
      const match = firstLine.match(/plugin:\s*([^\s\/]+)/)
      if (match && match[1] === pluginVersion) {
        return false
      }
      await this.clear(pluginVersion)
      return true
    } catch {
      await this.clear(pluginVersion)
      return true
    }
  }

  private async _append(level: string, msg: string, context?: Record<string, string>): Promise<void> {
    const ts = new Date().toISOString()
    let line = `[${ts}] [${level}]  ${msg}`
    if (context) {
      const ctxStr = Object.entries(context)
        .map(([k, v]) => `${k}=${v}`)
        .join("  ")
      line += `  ${ctxStr}`
    }

    this._buffer.push(line)
    if (this._buffer.length > MAX_LINES) {
      this._buffer.splice(0, this._buffer.length - MAX_LINES)
    }

    try {
      await fs.appendFile(this._logPath, line + "\n", "utf-8")
    } catch {
      // non-critical
    }
  }
}
