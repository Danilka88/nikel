import type { Entity } from "../types"

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zа-яё0-9\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function dedupEntities(entities: Entity[]): Entity[] {
  const seen = new Map<string, Entity>()

  for (const entity of entities) {
    const key = `${entity.type}:${normalizeName(entity.name)}`
    const existing = seen.get(key)

    if (existing) {
      const mergedAliases = new Set([...existing.aliases, ...entity.aliases, existing.name, entity.name])
      existing.aliases = [...mergedAliases]
      existing.properties = { ...existing.properties, ...entity.properties }
      existing.tags = [...new Set([...existing.tags, ...entity.tags])]
      existing.sourcePage = entity.sourcePage ?? existing.sourcePage
      existing.confidence = entity.confidence ?? existing.confidence
      existing.geography = entity.geography ?? existing.geography
      existing.year = entity.year ?? existing.year
      existing.sourceType = entity.sourceType ?? existing.sourceType
      if (entity.context && !existing.context?.includes(entity.context)) {
        existing.context = [existing.context, entity.context].filter(Boolean).join("\n")
      }
      existing.updatedAt = new Date().toISOString()
    } else {
      seen.set(key, { ...entity })
    }
  }

  return [...seen.values()]
}


