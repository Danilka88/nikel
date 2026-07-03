import { ChatOptions, Entity, ExtractionResult, OllamaClient, Relation } from "../../types"

const EXTRACT_PROMPT = `Ты — система извлечения структурированных знаний из научных документов. Проанализируй следующий markdown и извлеки все сущности и связи между ними.

Типы сущностей:
- material: материалы, сплавы, составы
- experiment: эксперименты, испытания, исследования
- property: свойства, характеристики (прочность, твёрдость...)
- mode: режимы, параметры (температура, давление, время...)
- equipment: установки, оборудование, приборы
- team: лаборатории, кафедры, организации
- person: имена исследователей
- conclusion: выводы, результаты
- topic: темы, области исследований

Типы связей:
- uses_material: эксперимент → материал
- has_property: материал/эксперимент → свойство
- in_mode: эксперимент → режим
- uses_equipment: эксперимент → оборудование
- conducted_by: эксперимент → команда/персона
- leads_to: режим/эксперимент → вывод
- related_to: общая связь
- precedes: хронологическая связь

Верни ТОЛЬКО JSON без пояснений по схеме:
{
  "entities": [
    {
      "id": "уникальный-id",
      "name": "Название сущности",
      "type": "material",
      "aliases": ["альтернативные названия"],
      "properties": {"ключ": "значение"},
      "context": "цитата из документа",
      "sourcePage": 1
    }
  ],
  "relations": [
    {
      "from": "id-сущности-откуда",
      "to": "id-сущности-куда",
      "type": "uses_material",
      "context": "контекст связи"
    }
  ]
}

Документ:
---`

const MAX_RETRIES = 1

export class EntityExtractor {
  constructor(
    private _ollama: OllamaClient,
    private _options: { model: string; url: string },
  ) {}

  async extract(markdown: string, sourcePath: string): Promise<ExtractionResult> {
    const prompt = `${EXTRACT_PROMPT}\n${markdown}\n---`

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const chatOpts: ChatOptions = {
          model: this._options.model,
          url: this._options.url,
          messages: [{ role: "user", content: prompt }],
        }

        const raw = await this._ollama.chat(chatOpts)
        const parsed = this.parseResult(raw, sourcePath)

        if (parsed) return parsed
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    throw lastError || new Error("Failed to extract entities")
  }

  private parseResult(raw: string, sourcePath: string): ExtractionResult | null {
    const json = extractJson(raw)
    if (!json) return null

    try {
      const data = JSON.parse(json)
      if (!isValidExtraction(data)) return null

      const now = new Date().toISOString()
      const entities: Entity[] = (data.entities || []).map((e: unknown) => {
        const obj = e as Record<string, unknown>
        return {
          id: String(obj.id || ""),
          name: String(obj.name || ""),
          type: obj.type as Entity["type"],
          aliases: extractStringArray(obj.aliases),
          properties: (obj.properties && typeof obj.properties === "object") ? obj.properties as Record<string, string> : {},
          tags: extractStringArray(obj.tags),
          source: sourcePath,
          sourcePage: typeof obj.sourcePage === "number" ? obj.sourcePage : undefined,
          context: typeof obj.context === "string" ? obj.context : undefined,
          createdAt: now,
          updatedAt: now,
        }
      })

      const relations: Relation[] = (data.relations || []).map((r: unknown) => {
        const obj = r as Record<string, unknown>
        return {
          from: String(obj.from || ""),
          to: String(obj.to || ""),
          type: obj.type as Relation["type"],
          context: typeof obj.context === "string" ? obj.context : undefined,
        }
      })

      return { entities, relations }
    } catch {
      return null
    }
  }
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zа-яё0-9\-]/g, "")
    .replace(/-+/g, "-")
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

function extractJson(raw: string): string | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : null
}

function isValidExtraction(data: unknown): data is { entities: unknown[]; relations: unknown[] } {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return Array.isArray(d.entities) && Array.isArray(d.relations)
}

function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  return []
}
