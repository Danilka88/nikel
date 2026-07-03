import { ChatOptions, Entity, OllamaClient, QueryResult, Relation } from "../../types"
import { KnowledgeGraph } from "./knowledge-graph"

const EXTRACT_ENTITIES_PROMPT = `Извлеки ключевые сущности из вопроса научной тематики. Верни ТОЛЬКО JSON-массив строк без пояснений.

Пример:
Вопрос: "Что делали по сплаву Х при режиме Y?"
Ответ: ["Сплав Х", "Режим Y"]

Вопрос: "Какая прочность у сплава Z?"
Ответ: ["Сплав Z", "прочность"]

Вопрос:`

const ANSWER_PROMPT = `Ты — научный ассистент. У тебя есть база знаний Obsidian со следующими фактами:

{contextMd}

Ответь на вопрос пользователя, используя ТОЛЬКО эти факты.
Если фактов недостаточно — скажи об этом.
В ответе используй [[ссылки]] на документы из базы знаний.
Отвечай на русском языке.

Вопрос: {question}`

export class QueryEngine {
  constructor(
    private _graph: KnowledgeGraph,
    private _ollama: OllamaClient,
    private _options: { model: string; url: string },
  ) {}

  async answerQuestion(question: string): Promise<QueryResult> {
    const entityNames = await this.extractEntities(question)

    const foundEntities: Entity[] = []
    const foundRelations: Relation[] = []
    const linkedDocs = new Set<string>()

    for (const name of entityNames) {
      const results = this._graph.search(name)
      for (const e of results.entities) {
        if (!foundEntities.some((fe) => fe.id === e.id)) {
          foundEntities.push(e)
          linkedDocs.add(`${this._options.model}/${e.type}/${e.name}.md`)
        }
      }
      for (const r of results.relations) {
        if (!foundRelations.some((fr) => fr.from === r.from && fr.to === r.to && fr.type === r.type)) {
          foundRelations.push(r)
        }
      }
    }

    const contextMd = this.buildContext(foundEntities, foundRelations)
    const answer = await this.generateAnswer(contextMd, question)

    return {
      answer,
      contextMd,
      linkedDocs: [...linkedDocs],
    }
  }

  private async extractEntities(question: string): Promise<string[]> {
    const chatOpts: ChatOptions = {
      model: this._options.model,
      url: this._options.url,
      messages: [{ role: "user", content: `${EXTRACT_ENTITIES_PROMPT} "${question}"\nОтвет:` }],
    }

    try {
      const raw = await this._ollama.chat(chatOpts)
      const json = raw.match(/\[[\s\S]*?\]/)
      if (json) {
        return JSON.parse(json[0]) as string[]
      }
    } catch {
      // fall through
    }

    return []
  }

  private buildContext(entities: Entity[], relations: Relation[]): string {
    if (entities.length === 0) return "В графе нет информации по вашему вопросу."

    const entityMap = new Map(entities.map((e) => [e.id, e]))
    const parts: string[] = []

    for (const entity of entities) {
      const entityRelations = relations.filter((r) => r.from === entity.id || r.to === entity.id)
      const relatedNames = entityRelations.map((r) => {
        const otherId = r.from === entity.id ? r.to : r.from
        const other = entityMap.get(otherId)
        return `  - [[${entity.name}]] → [[${other?.name || otherId}]] (${r.type})${r.context ? `: ${r.context}` : ""}`
      })

      parts.push(`[[${entity.name}]]${entity.context ? `: ${entity.context}` : ""}`)
      if (relatedNames.length > 0) {
        parts.push(...relatedNames)
      }
    }

    return parts.join("\n")
  }

  private async generateAnswer(contextMd: string, question: string): Promise<string> {
    const prompt = ANSWER_PROMPT
      .replace("{contextMd}", contextMd)
      .replace("{question}", question)

    const chatOpts: ChatOptions = {
      model: this._options.model,
      url: this._options.url,
      messages: [{ role: "user", content: prompt }],
    }

    const answer = await this._ollama.chat(chatOpts)
    return answer
  }
}
