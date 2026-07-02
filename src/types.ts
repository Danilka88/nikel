export interface NikelCommand {
  trigger: string
  description: string
  promptTemplate: string
  enabled: boolean
}

export interface NikelSettings {
  ollamaUrl: string
  model: string
  commands: NikelCommand[]
}

export interface TriggerMatch {
  line: number
  command: NikelCommand
  input: string
}

export interface GenerateOptions {
  prompt: string
  model: string
  url: string
  signal?: AbortSignal
}

export interface OllamaClient {
  generate(opts: GenerateOptions): Promise<string>
  listModels(url: string): Promise<string[]>
}

export const DEFAULT_SETTINGS: NikelSettings = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  commands: [
    {
      trigger: "@nikel_s",
      description: "Отправить задачу модели",
      promptTemplate: "Ты — полезный AI-ассистент. Отвечай ТОЛЬКО на русском языке. Не добавляй переводов на другие языки.\n\n{{input}}",
      enabled: true,
    },
    {
      trigger: "@nikel_f",
      description: "Исправить форматирование и грамматику",
      promptTemplate: "Исправь форматирование и грамматику текста. Сохрани исходный смысл. Отвечай ТОЛЬКО на русском языке. Не добавляй переводов.\n\n{{input}}",
      enabled: true,
    },
  ],
}
