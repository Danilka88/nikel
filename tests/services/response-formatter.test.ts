import { describe, it, expect } from "vitest"
import { formatResponse } from "../../src/services/response-formatter"

describe("formatResponse", () => {
  it("wraps single-line response in blockquote with model header", () => {
    const result = formatResponse("Hello world", "gemma4:e4b")
    expect(result).toBe([
      "> **Nikel (gemma4:e4b):**",
      "> Hello world",
      ">",
    ].join("\n"))
  })

  it("wraps multi-line response in blockquote", () => {
    const result = formatResponse("line1\nline2\nline3", "gemma4:e4b")
    expect(result).toBe([
      "> **Nikel (gemma4:e4b):**",
      "> line1",
      "> line2",
      "> line3",
      ">",
    ].join("\n"))
  })

  it("trims leading/trailing whitespace", () => {
    const result = formatResponse("  \nhello  \n", "gpt")
    expect(result).toBe([
      "> **Nikel (gpt):**",
      "> hello",
      ">",
    ].join("\n"))
  })

  it("returns empty string for empty input", () => {
    expect(formatResponse("", "test")).toBe("")
    expect(formatResponse("  ", "test")).toBe("")
  })

  it("preserves markdown formatting inside the quote", () => {
    const result = formatResponse("**bold** and `code`", "model")
    expect(result).toContain("> **bold** and `code`")
  })

  it("uses model name in the header", () => {
    const result = formatResponse("hello", "qwen3.5:4b")
    expect(result).toContain("**Nikel (qwen3.5:4b):**")
  })
})
