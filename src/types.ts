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
  pdfFolder: string
  txtFolder: string
  docxFolder: string
  nikelDir: string
  indexingMode: "vision" | "fast"
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
  chat(opts: ChatOptions): Promise<string>
  listModels(url: string): Promise<string[]>
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  images?: string[]
}

export interface ChatOptions {
  messages: ChatMessage[]
  model: string
  url: string
  signal?: AbortSignal
}

// ===== Knowledge Graph — типы сущностей =====

export type EntityType =
  | "material"
  | "experiment"
  | "property"
  | "mode"
  | "equipment"
  | "team"
  | "person"
  | "conclusion"
  | "topic"
  | "publication"
  | "process"
  | "facility"

export interface Entity {
  id: string
  name: string
  type: EntityType
  aliases: string[]
  properties: Record<string, string>
  tags: string[]
  source: string
  sourcePage?: number
  context?: string
  confidence?: "high" | "medium" | "low"
  geography?: "ru" | "foreign" | "both"
  year?: number
  sourceType?: "article" | "report" | "patent" | "conference" | "review" | "dissertation" | "other"
  createdAt: string
  updatedAt: string
}

export type RelationType =
  | "uses_material"
  | "has_property"
  | "in_mode"
  | "uses_equipment"
  | "conducted_by"
  | "leads_to"
  | "related_to"
  | "precedes"
  | "described_in"
  | "operates_at_condition"
  | "produces_output"
  | "validated_by"
  | "contradicts"

export interface Relation {
  from: string
  to: string
  type: RelationType
  context?: string
}

export interface IndexManifest {
  version: number
  lastIndexed: string
  files: Record<string, string>
  entities: Entity[]
  relations: Relation[]
}

export function createEmptyManifest(): IndexManifest {
  return {
    version: 1,
    lastIndexed: new Date().toISOString(),
    files: {},
    entities: [],
    relations: [],
  }
}

// ===== PDF/Ingestion =====

export interface PdfExtractorOptions {
  dpi: number
  maxDimension: number
  parallelPages: number
  visionModel: string
  indexingMode: "vision" | "fast"
}

export const DEFAULT_PDF_OPTIONS: PdfExtractorOptions = {
  dpi: 200,
  maxDimension: 1024,
  parallelPages: 2,
  visionModel: "gemma4:e4b",
  indexingMode: "vision",
}

export interface PdfExtractResult {
  markdown: string
  pageCount: number
  pages: string[]
}

export interface ExtractionResult {
  entities: Entity[]
  relations: Relation[]
}

export interface SearchFilters {
  text?: string
  types?: EntityType[]
  geography?: "ru" | "foreign" | "both"
  yearMin?: number
  yearMax?: number
  confidence?: "high" | "medium" | "low"
  tags?: string[]
  numericParams?: { name: string; operator: "lt" | "lte" | "gt" | "gte" | "eq"; value: number; unit?: string }[]
}

export interface FileChanges {
  newFiles: string[]
  changedFiles: string[]
  deletedFiles: string[]
  unchangedFiles: string[]
}

// ===== Query Engine =====

export interface QueryResult {
  answer: string
  contextMd: string
  linkedDocs: string[]
}

// ===== Document Generation =====

export interface DocContent {
  path: string
  content: string
  frontmatter: Record<string, unknown>
}

export interface CanvasNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  type: "file"
  file: string
  label: string
}

export interface CanvasEdge {
  id: string
  from: string
  to: string
  label: string
  fromSide?: "top" | "bottom" | "left" | "right"
  toSide?: "top" | "bottom" | "left" | "right"
}

export interface CanvasContent {
  path: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

// ===== Logging =====

export interface Logger {
  info(msg: string, context?: Record<string, string>): Promise<void>
  warn(msg: string, context?: Record<string, string>): Promise<void>
  error(msg: string, context?: Record<string, string>): Promise<void>
  clear(pluginVersion?: string): Promise<void>
  getLogContent(): Promise<string>
}

// ===== Расширение NikelSettings =====

export const DEFAULT_SETTINGS: NikelSettings = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  pdfFolder: "",
  txtFolder: "",
  docxFolder: "",
  nikelDir: "nikel",
  indexingMode: "vision",
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
