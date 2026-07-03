import { ChatOptions, Entity, EntityType, ExtractionResult, OllamaClient, Relation, RelationType } from "../../types"

const VALID_ENTITY_TYPES = new Set<EntityType>([
  "material", "experiment", "property", "mode",
  "equipment", "team", "person", "conclusion", "topic",
  "publication", "process", "facility",
])

const VALID_RELATION_TYPES = new Set<RelationType>([
  "uses_material", "has_property", "in_mode", "uses_equipment",
  "conducted_by", "leads_to", "related_to", "precedes",
  "described_in", "operates_at_condition", "produces_output",
  "validated_by", "contradicts",
])

const EXTRACT_PROMPT = `Ты — система извлечения структурированных знаний из научных и технических документов. Проанализируй следующий markdown и извлеки все сущности и связи между ними.

Типы сущностей:
- material: материалы, сплавы, составы, вещества (сульфаты, хлориды, никель...)
- experiment: эксперименты, испытания, исследования, протоколы опытов
- property: свойства, характеристики (прочность, твёрдость, концентрация, температура...)
- mode: режимы, параметры процессов (давление, время выдержки, скорость потока...)
- equipment: установки, оборудование, приборы, устройства (ванны, печи, насосы...)
- team: лаборатории, кафедры, организации, R&D-команды
- person: имена исследователей, авторов, экспертов
- conclusion: выводы, результаты, рекомендации
- topic: темы, области исследований
- publication: научные публикации, статьи, патенты, отчёты, обзоры (если документ сам является публикацией — создай одну сущность publication)
- process: технологические процессы, операции (выщелачивание, электроэкстракция, плавка, циркуляция, очистка...)
- facility: заводы, установки, лабораторные стенды, промышленные площадки

Типы связей:
- uses_material: процесс/эксперимент → материал
- has_property: материал/эксперимент → свойство
- in_mode: эксперимент/процесс → режим
- uses_equipment: процесс/эксперимент → оборудование
- conducted_by: эксперимент → команда/персона
- leads_to: режим/эксперимент → вывод
- related_to: общая связь
- precedes: хронологическая связь
- described_in: любая сущность → publication (источник, где описана)
- operates_at_condition: процесс/эксперимент → property/mode (условие работы)
- produces_output: процесс → material/conclusion (что производит)
- validated_by: вывод → эксперимент/publication (чем подтверждён)
- contradicts: один вывод противоречит другому

Для publication указывай confidence (уверенность: high/medium/low), geography (география: ru/foreign/both), year (год), sourceType (тип источника: article/report/patent/conference/review/dissertation).

Для числовых properties указывай единицы измерения в скобках, например: "Концентрация сульфатов (мг/л)".

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
      "sourcePage": 1,
      "confidence": "high",
      "geography": "ru",
      "year": 2024,
      "sourceType": "article"
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
      const entities: Entity[] = (data.entities || []).flatMap((e: unknown) => {
        const obj = e as Record<string, unknown>
        const type = obj.type as string
        if (!VALID_ENTITY_TYPES.has(type as EntityType)) return []

        return {
          id: String(obj.id || ""),
          name: String(obj.name || ""),
          type: type as EntityType,
          aliases: extractStringArray(obj.aliases),
          properties: (obj.properties && typeof obj.properties === "object") ? obj.properties as Record<string, string> : {},
          tags: extractStringArray(obj.tags),
          source: sourcePath,
          sourcePage: typeof obj.sourcePage === "number" ? obj.sourcePage : undefined,
          context: typeof obj.context === "string" ? obj.context : undefined,
          confidence: typeof obj.confidence === "string" && ["high", "medium", "low"].includes(obj.confidence) ? obj.confidence as "high" | "medium" | "low" : undefined,
          geography: typeof obj.geography === "string" && ["ru", "foreign", "both"].includes(obj.geography) ? obj.geography as "ru" | "foreign" | "both" : undefined,
          year: typeof obj.year === "number" ? obj.year : undefined,
          sourceType: typeof obj.sourceType === "string" && ["article", "report", "patent", "conference", "review", "dissertation", "other"].includes(obj.sourceType) ? obj.sourceType as "article" | "report" | "patent" | "conference" | "review" | "dissertation" | "other" : undefined,
          createdAt: now,
          updatedAt: now,
        }
      })

      const relations: Relation[] = (data.relations || []).flatMap((r: unknown) => {
        const obj = r as Record<string, unknown>
        const type = obj.type as string
        if (!VALID_RELATION_TYPES.has(type as RelationType)) return []

        return {
          from: String(obj.from || ""),
          to: String(obj.to || ""),
          type: type as RelationType,
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
