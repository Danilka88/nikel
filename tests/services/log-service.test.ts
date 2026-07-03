import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { FileLogger } from "../../src/services/log-service"

const TEST_DIR = "/tmp/nikel-log-test"

describe("FileLogger", () => {
  let logger: FileLogger

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true })
    logger = new FileLogger(TEST_DIR)
  })

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  it("writes and reads log entries", async () => {
    await logger.clear("1.0.0")
    await logger.info("test message")
    await logger.warn("warning")
    await logger.error("error occurred")

    const content = await logger.getLogContent()
    expect(content).toContain("[INFO]  test message")
    expect(content).toContain("[WARN]  warning")
    expect(content).toContain("[ERROR]  error occurred")
    expect(content).toContain("# Nikel Log / plugin: 1.0.0")
  })

  it("includes context in log entries", async () => {
    await logger.clear()
    await logger.info("process", { file: "test.pdf", pages: "3" })

    const content = await logger.getLogContent()
    expect(content).toContain("file=test.pdf")
    expect(content).toContain("pages=3")
  })

  it("clear resets buffer and file", async () => {
    await logger.clear("1.0.0")
    await logger.info("first entry")
    await logger.clear("1.0.0")

    const content = await logger.getLogContent()
    expect(content).not.toContain("first entry")
    expect(content).toContain("# Nikel Log / plugin: 1.0.0")
  })

  it("checkVersion clears log on version mismatch", async () => {
    await logger.clear("1.0.0")
    await logger.info("old version log")

    await logger.checkVersion("2.0.0")
    const content = await logger.getLogContent()
    expect(content).toContain("plugin: 2.0.0")
    expect(content).not.toContain("old version")
  })

  it("checkVersion does not clear on same version", async () => {
    await logger.clear("1.0.0")
    await logger.info("same version log")

    await logger.checkVersion("1.0.0")
    const content = await logger.getLogContent()
    expect(content).toContain("same version log")
  })

  it("returns empty string when log is empty", async () => {
    const content = await logger.getLogContent()
    expect(content).toBe("")
  })

  it("limits buffer to MAX_LINES entries", async () => {
    await logger.clear()
    for (let i = 0; i < 1000; i++) {
      await logger.info(`entry ${i}`)
    }
    const content = await logger.getLogContent()
    const lines = content.split("\n")
    // header + 500 entries
    expect(lines.length).toBeLessThanOrEqual(501)
    expect(content).toContain("entry 500")
    expect(content).not.toContain("entry 0")
  })
})
