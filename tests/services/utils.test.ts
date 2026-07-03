import { describe, it, expect } from "vitest"
import { getSubDir, safeFileName, detectSourceType } from "../../src/utils"

describe("getSubDir", () => {
  it("returns correct dir for new entity types", () => {
    expect(getSubDir("publication")).toBe("publications")
    expect(getSubDir("process")).toBe("processes")
    expect(getSubDir("facility")).toBe("facilities")
  })

  it("returns correct dir for existing entity types", () => {
    expect(getSubDir("material")).toBe("materials")
    expect(getSubDir("experiment")).toBe("experiments")
  })

  it("returns 'other' for unknown types", () => {
    expect(getSubDir("unknown")).toBe("other")
  })
})

describe("safeFileName", () => {
  it("removes invalid filesystem characters", () => {
    expect(safeFileName("test:file?name*")).toBe("test-file-name")
  })
})

describe("detectSourceType", () => {
  it("detects 'article' from Статьи folder", () => {
    expect(detectSourceType("Статьи/ivanov2024.pdf")).toBe("article")
  })

  it("detects 'report' from Доклады folder", () => {
    expect(detectSourceType("Доклады/report-2024.pdf")).toBe("report")
  })

  it("detects 'conference' from Материалы конференций folder", () => {
    expect(detectSourceType("Материалы конференций/conf-2024.pdf")).toBe("conference")
  })

  it("detects 'review' from Обзоры folder", () => {
    expect(detectSourceType("Обзоры/review-2024.pdf")).toBe("review")
  })

  it("returns 'other' for unknown folder", () => {
    expect(detectSourceType("Other/docs.pdf")).toBe("other")
  })

  it("handles nested paths", () => {
    expect(detectSourceType("base/Статьи/sub/paper.pdf")).toBe("article")
  })
})
