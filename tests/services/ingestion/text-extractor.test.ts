import { describe, it, expect } from "vitest"
import { TextExtractor } from "../../../src/services/ingestion/text-extractor"

describe("TextExtractor", () => {
  const extractor = new TextExtractor()

  it("extracts text from txt Uint8Array", async () => {
    const data = new TextEncoder().encode("Hello, world!\nSecond line")
    const result = await extractor.extractTxt(data)

    expect(result.markdown).toBe("Hello, world!\nSecond line")
    expect(result.pageCount).toBe(1)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]).toBe("Hello, world!\nSecond line")
  })

  it("handles empty txt", async () => {
    const data = new Uint8Array(0)
    const result = await extractor.extractTxt(data)

    expect(result.markdown).toBe("")
    expect(result.pageCount).toBe(1)
  })

  it("returns empty result for invalid docx data", async () => {
    const data = new TextEncoder().encode("Not a real docx")
    const result = await extractor.extractDocx(data)

    expect(result.markdown).toBe("")
    expect(result.pageCount).toBe(0)
    expect(result.pages).toHaveLength(0)
  })

  it("extractTxt normalizes line endings", async () => {
    const data = new TextEncoder().encode("Line1\r\nLine2\r\nLine3")
    const result = await extractor.extractTxt(data)

    expect(result.markdown).toBe("Line1\nLine2\nLine3")
  })
})
