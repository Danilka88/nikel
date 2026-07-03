import * as fs from "fs/promises"
import * as path from "path"
import { Entity, IndexManifest, Relation, createEmptyManifest } from "../../types"
import { normalizeName } from "../ingestion/entity-extractor"

export class KnowledgeGraph {
  private _manifest: IndexManifest = createEmptyManifest()

  constructor(
    private _manifestPath: string,
  ) {}

  get entities(): Entity[] {
    return this._manifest.entities
  }

  get relations(): Relation[] {
    return this._manifest.relations
  }

  get manifest(): IndexManifest {
    return this._manifest
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this._manifestPath, "utf-8")
      this._manifest = JSON.parse(data) as IndexManifest
    } catch {
      this._manifest = createEmptyManifest()
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this._manifestPath), { recursive: true })
    const tmpPath = this._manifestPath + ".tmp"
    await fs.writeFile(tmpPath, JSON.stringify(this._manifest, null, 2), "utf-8")
    await fs.rename(tmpPath, this._manifestPath)
  }

  addEntity(entity: Entity): void {
    this._manifest.entities.push(entity)
  }

  addRelation(relation: Relation): void {
    this._manifest.relations.push(relation)
  }

  getEntity(id: string): Entity | undefined {
    return this._manifest.entities.find((e) => e.id === id)
  }

  getEntityByName(name: string, type?: string): Entity | undefined {
    const normalized = normalizeName(name)
    return this._manifest.entities.find((e) => {
      if (type && e.type !== type) return false
      if (normalizeName(e.name) === normalized) return true
      return e.aliases.some((a) => normalizeName(a) === normalized)
    })
  }

  findEntities(type?: string, query?: string): Entity[] {
    let result = this._manifest.entities
    if (type) {
      result = result.filter((e) => e.type === type)
    }
    if (query) {
      const q = query.toLowerCase()
      result = result.filter((e) => {
        if (e.name.toLowerCase().includes(q)) return true
        if (e.aliases.some((a) => a.toLowerCase().includes(q))) return true
        if (e.tags.some((t) => t.toLowerCase().includes(q))) return true
        return false
      })
    }
    return result
  }

  findRelated(entityId: string, relationType?: string): Relation[] {
    return this._manifest.relations.filter((r) => {
      if (r.from !== entityId && r.to !== entityId) return false
      if (relationType && r.type !== relationType) return false
      return true
    })
  }

  search(text: string): { entities: Entity[]; relations: Relation[] } {
    const q = text.toLowerCase()
    const matchedIds = new Set<string>()

    const entities = this._manifest.entities.filter((e) => {
      if (e.name.toLowerCase().includes(q)) { matchedIds.add(e.id); return true }
      if (e.aliases.some((a) => a.toLowerCase().includes(q))) { matchedIds.add(e.id); return true }
      if (e.context?.toLowerCase().includes(q)) { matchedIds.add(e.id); return true }
      if (e.tags.some((t) => t.toLowerCase().includes(q))) { matchedIds.add(e.id); return true }
      return false
    })

    const relations = this._manifest.relations.filter((r) => {
      return matchedIds.has(r.from) || matchedIds.has(r.to)
    })

    return { entities, relations }
  }

  mergeIndex(manifest: IndexManifest): void {
    for (const entity of manifest.entities) {
      const key = `${entity.type}:${normalizeName(entity.name)}`
      const existing = this._manifest.entities.find((e) => {
        return `${e.type}:${normalizeName(e.name)}` === key
      })

      if (existing) {
        const mergedAliases = new Set([...existing.aliases, ...entity.aliases, existing.name, entity.name])
        existing.aliases = [...mergedAliases]
        existing.properties = { ...existing.properties, ...entity.properties }
        existing.tags = [...new Set([...existing.tags, ...entity.tags])]
        existing.sourcePage = entity.sourcePage ?? existing.sourcePage
        if (entity.context && !existing.context?.includes(entity.context)) {
          existing.context = [existing.context, entity.context].filter(Boolean).join("\n")
        }
        existing.updatedAt = new Date().toISOString()
      } else {
        this._manifest.entities.push({ ...entity })
      }
    }

    for (const relation of manifest.relations) {
      const exists = this._manifest.relations.some(
        (r) => r.from === relation.from && r.to === relation.to && r.type === relation.type,
      )
      if (!exists) {
        this._manifest.relations.push({ ...relation })
      }
    }
  }

  buildCluster(entityId: string, depth = 1): { entities: Entity[]; relations: Relation[] } {
    const visited = new Set<string>()
    const queue = [entityId]
    const resultEntities: Entity[] = []
    const resultRelations: Relation[] = []

    for (let d = 0; d <= depth && queue.length > 0; d++) {
      const levelSize = queue.length
      for (let i = 0; i < levelSize; i++) {
        const currentId = queue.shift()!
        if (visited.has(currentId)) continue
        visited.add(currentId)

        const entity = this.getEntity(currentId)
        if (entity) resultEntities.push(entity)

        const related = this.findRelated(currentId)
        for (const rel of related) {
          if (!resultRelations.some((r) => r.from === rel.from && r.to === rel.to && r.type === rel.type)) {
            resultRelations.push(rel)
          }
          const nextId = rel.from === currentId ? rel.to : rel.from
          if (!visited.has(nextId) && d < depth) {
            queue.push(nextId)
          }
        }
      }
    }

    return { entities: resultEntities, relations: resultRelations }
  }

  getStats(): { entityCount: number; relationCount: number; fileCount: number } {
    const uniqueFiles = new Set(this._manifest.entities.map((e) => e.source))
    return {
      entityCount: this._manifest.entities.length,
      relationCount: this._manifest.relations.length,
      fileCount: uniqueFiles.size,
    }
  }
}
