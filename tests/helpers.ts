import type { Entity, Relation } from "../src/types"

export function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "test-entity",
    name: "Test Entity",
    type: "material",
    aliases: [],
    properties: {},
    tags: [],
    source: "test-source.pdf",
    sourcePage: undefined,
    context: undefined,
    confidence: undefined,
    geography: undefined,
    year: undefined,
    sourceType: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

export function makeRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    from: "entity-1",
    to: "entity-2",
    type: "related_to",
    context: undefined,
    ...overrides,
  }
}
