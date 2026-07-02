import { describe, it, expect } from "vitest"
import { findTrigger, buildPrompt } from "../../src/services/trigger-parser"
import { NikelCommand } from "../../src/types"

const mockCommands: NikelCommand[] = [
  {
    trigger: "@nikel_s",
    description: "Send task to model",
    promptTemplate: "You are a helpful assistant.\n\n{{input}}",
    enabled: true,
  },
  {
    trigger: "@nikel_f",
    description: "Fix formatting",
    promptTemplate: "Fix the formatting:\n\n{{input}}",
    enabled: true,
  },
  {
    trigger: "@nikel_disabled",
    description: "Disabled command",
    promptTemplate: "{{input}}",
    enabled: false,
  },
]

describe("findTrigger", () => {
  it("finds trigger on the current cursor line", () => {
    const lines = [
      "Some text above",
      "@nikel_s write a poem",
      "some text below",
    ]
    const result = findTrigger(lines, mockCommands, 1)
    expect(result).not.toBeNull()
    expect(result!.line).toBe(1)
    expect(result!.command.trigger).toBe("@nikel_s")
    expect(result!.input).toBe("write a poem")
  })

  it("scans upwards from cursor line", () => {
    const lines = [
      "@nikel_s write a poem",
      "some text in between",
      "cursor is here",
    ]
    const result = findTrigger(lines, mockCommands, 2)
    expect(result).not.toBeNull()
    expect(result!.line).toBe(0)
    expect(result!.input).toBe("write a poem")
  })

  it("returns null when no trigger is found", () => {
    const lines = [
      "just some text",
      "nothing here",
    ]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result).toBeNull()
  })

  it("skips disabled commands", () => {
    const lines = ["@nikel_disabled test"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result).toBeNull()
  })

  it("matches the correct command among multiple", () => {
    const lines = ["@nikel_f fix this text please"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result).not.toBeNull()
    expect(result!.command.trigger).toBe("@nikel_f")
    expect(result!.input).toBe("fix this text please")
  })

  it("extracts text after trigger with leading spaces trimmed", () => {
    const lines = ["@nikel_s    hello world"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result!.input).toBe("hello world")
  })

  it("returns empty string when no text follows trigger", () => {
    const lines = ["@nikel_s"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result!.input).toBe("")
  })

  it("handles trigger mid-line", () => {
    const lines = ["some text @nikel_s do something"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result).not.toBeNull()
    expect(result!.input).toBe("do something")
  })

  it("picks the first matching command if two triggers are on the same line", () => {
    const lines = ["@nikel_s @nikel_f something"]
    const result = findTrigger(lines, mockCommands, 0)
    expect(result!.command.trigger).toBe("@nikel_s")
    expect(result!.input).toBe("@nikel_f something")
  })

  it("with empty lines array returns null", () => {
    expect(findTrigger([], mockCommands, 0)).toBeNull()
  })
})

describe("buildPrompt", () => {
  it("replaces {{input}} with the user text", () => {
    const cmd: NikelCommand = {
      trigger: "@nikel_s",
      description: "",
      promptTemplate: "System: {{input}}",
      enabled: true,
    }
    expect(buildPrompt(cmd, "hello world")).toBe("System: hello world")
  })

  it("replaces multiple {{input}} occurrences", () => {
    const cmd: NikelCommand = {
      trigger: "@nikel_s",
      description: "",
      promptTemplate: "Q: {{input}}\nA: {{input}}",
      enabled: true,
    }
    expect(buildPrompt(cmd, "test")).toBe("Q: test\nA: test")
  })

  it("handles no {{input}} in template gracefully", () => {
    const cmd: NikelCommand = {
      trigger: "@nikel_s",
      description: "",
      promptTemplate: "Just a static prompt",
      enabled: true,
    }
    expect(buildPrompt(cmd, "whatever")).toBe("Just a static prompt")
  })
})
