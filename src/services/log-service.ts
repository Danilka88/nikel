import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "../types"

const MAX_LINES = 500
const FLUSH_INTERVAL_MS = 200
const FLUSH_BATCH_SIZE = 20

export class FileLogger implements Logger {
  private _logPath: string
  private _buffer: string[] = []
  private _pending: string[] = []
  private _pluginVersion = ""
  private _flushTimer: ReturnType<typeof setTimeout> | null = null
  private _flushPromise: Promise<void> | null = null

  constructor(logDir: string) {
    const nikeldir = path.join(logDir, ".nikel")
    this._logPath = path.join(nikeldir, "nikel.log")
  }

  async info(msg: string, context?: Record<string, string>): Promise<void> {
    this._enqueue("INFO", msg, context)
  }

  async warn(msg: string, context?: Record<string, string>): Promise<void> {
    this._enqueue("WARN", msg, context)
  }

  async error(msg: string, context?: Record<string, string>): Promise<void> {
    this._enqueue("ERROR", msg, context)
  }

  async clear(pluginVersion?: string): Promise<void> {
    await this._flushNow()
    this._buffer = []
    this._pending = []
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
    await this._flushNow()
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

  private _enqueue(level: string, msg: string, context?: Record<string, string>): void {
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

    this._pending.push(line)
    this._scheduleFlush()
  }

  private _scheduleFlush(): void {
    if (this._flushPromise) return

    if (this._pending.length >= FLUSH_BATCH_SIZE) {
      this._flushNow()
      return
    }

    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null
        this._flushNow()
      }, FLUSH_INTERVAL_MS)
    }
  }

  private async _flushNow(): Promise<void> {
    if (this._flushPromise) {
      await this._flushPromise
      return
    }

    const lines = this._pending.splice(0, this._pending.length)
    if (lines.length === 0) return

    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = null
    }

    this._flushPromise = (async () => {
      try {
        await fs.appendFile(this._logPath, lines.join("\n") + "\n", "utf-8")
      } catch {
        // non-critical
      }
    })()

    await this._flushPromise
    this._flushPromise = null
  }
}
