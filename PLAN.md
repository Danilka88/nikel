# PLAN — Nikel Knowledge Graph System

## 1. Цель

Построить внутри Obsidian плагина Nikel полноценную knowledge graph систему, которая:

- Принимает на вход папку с PDF-документами (научные статьи, отчёты, каталоги)
- Парсит их через мультимодальную LLM (gemma4:e4b, локально через Ollama)
- Извлекает сущности: материалы, эксперименты, свойства, режимы, установки, команды, выводы
- Строит граф связей между ними
- Генерирует документы Obsidian (.md с [[links]], #tags, frontmatter, Dataview)
- Генерирует Obsidian Canvas (.canvas) для визуализации графа
- Отвечает на вопросы пользователя через @nikel_s, используя контекст из графа

---

## 2. Принятые решения

| Решение | Значение | Обоснование |
|---------|----------|-------------|
| PDF→LLM Vision | Полные страницы как PNG → gemma4:e4b | LLM гибче, понимает таблицы/схемы, не теряет контекст |
| DPI | 200 (ресайз до 1024px по большей стороне) | 150 — теряет текст таблиц, 300 — избыточно, не влезает в 1024px |
| Parallelism | 2 страницы одновременно | OOM-safe, Ollama не захлёбывается |
| Хранилище графа | JSON (index.json) | Человекочитаем, LLM сама формирует, легко дебажить. SQLite если >100K сущностей |
| Модель Vision | gemma4:e4b | Мультимодальная (text+image), 128K контекст, Apache 2.0, уже стоит у пользователя |
| Индексация | По MD5 хешам файлов | Инкрементально — только новые/изменённые PDF |
| Структура папок | LLM авто-категоризация | Пользователь не раскидывает вручную |
| Нейминг | Всё в одном плагине Nikel | Без разделения на отдельные плагины |
| Open source | Только open source, без внешних API | pdfjs-dist (Apache 2.0) — единственная новая зависимость |

---

## 3. Зависимости

### Новые npm-пакеты

```bash
npm install pdfjs-dist
npm install --save-dev @types/pdfjs-dist    # если нужно
```

`pdfjs-dist` — pure JavaScript, встроится в `main.js` через esbuild.

### Почему не нужен `sharp`

`pdfjs-dist` рендерит страницы прямо в canvas с нужным DPI через viewport. В Electron (Obsidian) доступен `OffscreenCanvas` — не нужны native модули. Ресайз до 1024px делается параметрами viewport при рендеринге.

Поток без native-зависимостей:

```
pdfjs-dist.loadDocument(path) → page.render({canvas, viewport}) → canvas.toBlob() → base64 → Ollama Vision
```

---

## 4. Типы данных

Все новые типы — в `src/types.ts`.

```typescript
// ===== Сущности графа =====

type EntityType =
  | "material"      // Сплав-X, Сталь-45
  | "experiment"    // Эксперимент по закалке
  | "property"      // Прочность, Твёрдость, Пластичность
  | "mode"          // Режим Y, Температура 800°C
  | "equipment"     // Установка-001, Печь-ТВ
  | "team"          // Лаборатория-имени-Т, Кафедра МТ
  | "person"        // Иванов И.И., Петров П.А.
  | "conclusion"    // Вывод: режим Y увеличивает прочность
  | "topic"         // Турбинные сплавы, Термообработка

interface Entity {
  id: string
  name: string
  type: EntityType
  aliases: string[]
  properties: Record<string, string>
  tags: string[]
  source: string            // какой PDF-файл
  sourcePage?: number
  context?: string          // выдержка из документа
  createdAt: string         // ISO date
  updatedAt: string
}

// ===== Связи графа =====

type RelationType =
  | "uses_material"     // эксперимент → материал
  | "has_property"      // материал → свойство
  | "in_mode"           // эксперимент → режим
  | "uses_equipment"    // эксперимент → установка
  | "conducted_by"      // эксперимент → команда/персона
  | "leads_to"          // режим → вывод
  | "related_to"        // общая связь
  | "precedes"          // хронология: exp-001 → exp-002

interface Relation {
  from: string          // entity id
  to: string            // entity id
  type: RelationType
  context?: string      // контекст связи
}

// ===== Манифест индекса =====

interface IndexManifest {
  version: number
  lastIndexed: string
  files: Record<string, string>     // filePath → MD5 hash
  entities: Entity[]
  relations: Relation[]
}

// ===== Генерация документов =====

interface DocContent {
  path: string          // относительный путь: nikel/materials/Сплав-X.md
  content: string       // полный .md
  frontmatter: Record<string, unknown>
}

interface CanvasContent {
  path: string
  nodes: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    type: "file"
    file: string        // путь к .md
    label: string
  }>
  edges: Array<{
    id: string
    from: string        // node id
    to: string
    label: string
    fromSide?: "top" | "bottom" | "left" | "right"
    toSide?: "top" | "bottom" | "left" | "right"
  }>
}

// ===== Результат запроса к графу =====

interface QueryResult {
  answer: string            // ответ LLM
  contextMd: string         // найденные факты в markdown ([[links]])
  linkedDocs: string[]      // пути к .md файлам-источникам
}

// ===== Дополнение NikelSettings =====

// Добавить в существующий NikelSettings:
pdfFolder: string                     // путь к папке с PDF
nikelDir: string                      // корень генерации: vault/nikel/
```

---

## 5. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                     main.ts (оркестратор)                    │
│  onload() → инициализация сервисов, команды, настройки       │
│  processNikelTask() → @nikel_s с графом или inline           │
│  runIndexing() → полный цикл индексации                      │
└────────────────┬───────────────┬────────────────┬───────────┘
                 │               │                │
         ┌───────▼───────┐ ┌────▼────┐    ┌──────▼──────┐
         │  Ingestion    │ │  Graph  │    │  Generation  │
         │  Pipeline     │ │  Engine │    │  Engine      │
         │               │ │         │    │              │
         │ pdf-extractor │ │knowledge│    │ md-generator │
         │ entity-extr.  │ │-graph   │    │ canvas-gen.  │
         │ file-watcher  │ │query    │    │ index-gen.   │
         │               │ │-engine  │    │              │
         └───────┬───────┘ └────┬────┘    └──────┬───────┘
                 │              │                │
                 └──────────────┼────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │      index.json       │
                    │  (entities + relations │
                    │   + file hashes)       │
                    └───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │      Ollama API       │
                    │  gemma4:e4b (vision)   │
                    └───────────────────────┘
```

### Data Flow: Полный цикл индексации

```
1. Пользователь указывает PDF-папку в настройках
2. runIndexing():
   a. file-watcher читает .nikel/file-hashes.json
   b. Сравнивает хеши с файлами на диске
   c. Формирует очередь: новые, изменённые, удалённые
3. Для каждого PDF:
   a. pdf-extractor: pdfjs → страницы PNG (200 DPI, 1024px)
   b. Vision LLM: страница → markdown (2 страницы параллельно)
   c. Повторный LLM-проход: сквозная агрегация страниц
4. entity-extractor:
   a. LLM: markdown → structured JSON (entities + relations)
   b. normalizeName + fuzzy dedup
5. knowledge-graph: merge в index.json (запись через temp → rename)
6. Для каждого PDF — обновление file-hashes.json
```

### Data Flow: @nikel_s с контекстом

```
1. Пользователь вводит: @nikel_s что делали по сплаву X при режиме Y?
2. query-engine:
   a. LLM извлекает сущности из вопроса → ["Сплав-X", "Режим-Y"]
   b. Поиск в графе: findEntities("material", "Сплав-X")
   c. Поиск связей: findRelated(entityId) → эксперименты, свойства
   d. Сборка контекста:
      [[Сплав-X]]:
        - [[exp-001]]: прочность 450 МПа (+12%), режим Y
        - [[exp-005]]: твёрдость 320 HV (+5%), режим Z
   e. LLM с контекстом → генерирует ответ
3. md-generator: создаёт новый .md документ с ответом и [[ссылками]] на источники
4. Вывод: открывает или вставляет новый документ
```

---

## 6. Сервисы — спецификация

### 6.1 Ingestion

#### `src/services/ingestion/pdf-extractor.ts`

```typescript
export class PdfExtractor {
  constructor(
    private _ollama: OllamaClient,           // injectable
    private _pdfjs: typeof pdfjsLib,         // injectable для моков
    private _options: PdfExtractorOptions = defaultOptions,
  ) {}

  async extractPdf(pdfPath: string): Promise<PdfExtractResult>
  // 1. pdfjs.loadDocument(pdfPath)
  // 2. Для каждой страницы (с parallelism 2):
  //    a. renderPageToPng(page, 200dpi, 1024px) → Blob
  //    b. visionExtract(blob) → markdown текста страницы
  // 3. Если >1 страницы: вторым LLM-проходом агрегировать в единый документ
  // 4. Вернуть {markdown: string, pageCount: number}
}

interface PdfExtractorOptions {
  dpi: number        // 200
  maxDimension: number  // 1024
  parallelPages: number // 2
  visionModel: string   // gemma4:e4b
}

interface PdfExtractResult {
  markdown: string
  pageCount: number
  pages: string[]       // markdown каждой страницы
}
```

**Vision prompt для страницы:**
```
Ты — ассистент для извлечения научной информации. 
Опиши содержимое этой страницы PDF в формате Markdown.
Сохрани: заголовки, таблицы, списки, числовые данные, формулы (LaTeX).
Не пропускай подписи к рисункам, сноски, примечания.
Если страница содержит таблицу — оформи её в Markdown.
```

**Vision prompt для агрегации:**
```
Ты получил markdown нескольких страниц одного документа.
Объедини их в единый связный документ.
Удали дублирующиеся заголовки.
Сохрани все данные, таблицы, числовые значения.
```

#### `src/services/ingestion/entity-extractor.ts`

```typescript
export class EntityExtractor {
  constructor(private _ollama: OllamaClient) {}

  async extract(markdown: string, sourcePath: string): Promise<ExtractionResult>

  static normalizeName(name: string): string
  // lower case, trim, дефис вместо пробелов, убрать лишние символы
  // "Сплав X (легированный)" → "сплав-x"
  // "сплав Х" → "сплав-x"    (замена кириллической Х)

  static dedupEntities(entities: Entity[]): Entity[]
  // fuzzy merge: одинаковый type + normalized name match
}

interface ExtractionResult {
  entities: Entity[]
  relations: Relation[]
}
```

**Prompt для извлечения:**
```
Ты — система извлечения структурированных знаний из научных документов.
Проанализируй следующий markdown и извлеки все сущности и связи между ними.

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
      "type": "material|experiment|...",
      "aliases": ["альтернативные названия"],
      "properties": {"ключ": "значение"},
      "context": "цитата из документа",
      "sourcePage": 5
    }
  ],
  "relations": [
    {
      "from": "id-сущности-откуда",
      "to": "id-сущности-куда",
      "type": "uses_material|...",
      "context": "контекст связи"
    }
  ]
}

Документ:
---
{markdown}
---
```

#### `src/services/ingestion/file-watcher.ts`

```typescript
export class FileWatcher {
  constructor(private _nikelDir: string) {}

  async scan(folderPath: string): Promise<FileChanges>
  // Читает file-hashes.json
  // Сканирует папку рекурсивно (*.pdf)
  // Сравнивает хеши → определяет new/changed/deleted

  async loadManifest(): Promise<IndexManifest | null>
  async saveManifest(manifest: IndexManifest): Promise<void>

  getHash(filePath: string): Promise<string>
  // MD5 хеш файла
}

interface FileChanges {
  newFiles: string[]
  changedFiles: string[]
  deletedFiles: string[]
  unchangedFiles: string[]
}
```

---

### 6.2 Graph Engine

#### `src/services/graph/knowledge-graph.ts`

```typescript
export class KnowledgeGraph {
  constructor(
    private _manifestPath: string,   // путь к index.json
  ) {}

  async load(): Promise<void>
  // Загружает index.json в память

  async save(): Promise<void>
  // Транзакционная запись: write to .tmp → rename

  addEntity(entity: Entity): void
  addRelation(relation: Relation): void

  getEntity(id: string): Entity | undefined
  getEntityByName(name: string, type?: EntityType): Entity | undefined
  findEntities(type?: EntityType, query?: string): Entity[]

  findRelated(entityId: string, relationType?: RelationType): Relation[]
  // Все связи, где entityId === from или entityId === to

  search(text: string): { entities: Entity[]; relations: Relation[] }
  // Полнотекстовый поиск по name, aliases, context

  mergeIndex(manifest: IndexManifest): void
  // Dedup по (type + normalizedName)
  // Обновление aliases, properties
  // Добавление новых sourcePage

  buildCluster(entityId: string, depth?: number): { entities: Entity[]; relations: Relation[] }
  // BFS по графу на depth уровней
  // Для канваса: все связанные сущности

  getStats(): { entityCount: number; relationCount: number; fileCount: number }
}
```

**Dedup логика:**
```typescript
// Нормализация: lower case, trim, дефисы, убрать скобки
// Сравнение: если type совпадает И normalizedName совпадает → merge:
//   - aliases объединяются (Set)
//   - properties объединяются (последняя побеждает)
//   - sourcePage дополняется
//   - context дополняется
```

#### `src/services/graph/query-engine.ts`

```typescript
export class QueryEngine {
  constructor(
    private _graph: KnowledgeGraph,
    private _ollama: OllamaClient,
    private _model: string,
  ) {}

  async answerQuestion(question: string): Promise<QueryResult>
  // 1. extractEntities(question) → ["Сплав-X", "Режим-Y"]
  // 2. findEntities() для каждого
  // 3. findRelated() для → собираем факты
  // 4. buildContext() → markdown с [[ссылками]]
  // 5. generateAnswer(context + question) → ответ LLM
  // 6. return {answer, contextMd, linkedDocs}

  private async extractEntities(question: string): Promise<string[]>
  // LLM: "Извлеки ключевые сущности из вопроса. Верни JSON-массив строк."

  private buildContext(entities: Entity[], relations: Relation[]): string
  // Формирует блок:
  // ## Найденные факты
  // - [[Материал]]: [[exp-001]] — свойство: 450 МПа
  // - ...
}

/**
 * Prompt для генерации ответа:
 *
 * Ты — научный ассистент. У тебя есть база знаний Obsidian со следующими фактами:
 *
 * {contextMd}
 *
 * Ответь на вопрос пользователя, используя ТОЛЬКО эти факты.
 * Если фактов недостаточно — скажи об этом.
 * В ответе используй [[ссылки]] на документы из базы знаний.
 * Отвечай на русском языке.
 *
 * Вопрос: {question}
 */
```

---

### 6.3 Generation Engine

#### `src/services/generation/md-generator.ts`

```typescript
export class MdGenerator {
  constructor(private _nikelDir: string) {}

  generateDoc(entity: Entity, relations: Relation[]): DocContent
  // Определяет подпапку: materials/ | experiments/ | properties/ | ... по entity.type
  // Формирует frontmatter
  // Формирует тело: название, [[links]], #tags, dataview-поля

  generateAnswerDoc(queryResult: QueryResult, question: string): DocContent
  // Создаёт документ-ответ от @nikel_s
  // Путь: _answers/YYYY-MM-DD-hhmmss.md
  /**
   * ---
   * type: answer
   * question: "..."
   * sources: [nikel/experiments/exp-001.md, ...]
   * created: 2024-03-15T10:30:00
   * ---
   * 
   * ## Ответ
   * {answer}
   * 
   * ## Источники
   * - [[nikel/experiments/exp-001]]
   * - ...
   */
}
```

**Правила генерации `.md`:**

1. **Frontmatter** (YAML):
   - `id`, `type`, `name`, `tags` — обязательны
   - `aliases` — [[Obsidian]] для поиска по разным именам
   - Поля для Dataview: `material:: [[Сплав-X]]`, `property:: Прочность`
   - `source`, `sourcePage` — для обратной связи с PDF

2. **Тело**:
   - `## Имя` — заголовок первого уровня
   - Связанные сущности через `[[entity-name]]`
   - Хэштеги: `#эксперимент`, `#сплав-x`, `#прочность`
   - Таблицы для свойств
   - Links на эксперименты: `[[exp-001]]`, `[[exp-005]]`
   - Dataview inline: `property:: value`

3. **Пример полного `.md`:**

```markdown
---
id: exp-001
type: experiment
name: Влияние режима Y на прочность сплава X
tags: [эксперимент, сплав-X, режим-Y, прочность]
material:: [[Сплав-X]]
mode:: [[Режим-Y]]
equipment:: [[Установка-001]]
team:: [[Лаборатория-имени-Т]]
date: 2024-03-15
source: Исходный-PDF-документ.pdf
sourcePage: 15
---

## Влияние режима Y на прочность сплава X

**Материал:** [[Сплав-X]]
**Установка:** [[Установка-001]]
**Команда:** [[Лаборатория-имени-Т]]

### Параметры режима
- Температура: 800°C
- Давление: 10 атм
- Время выдержки: 2ч

### Результаты
| Свойство | Значение | Изменение |
|----------|----------|-----------|
| [[Прочность]] | 450 МПа | +12% |
| Твёрдость | 320 HV | +5% |

### Выводы
Режим Y увеличивает прочность сплава X на 12%. #ключевой_результат

### Связанные эксперименты
- [[exp-002]] — тот же режим, сплав Y
- [[exp-005]] — сплав X, режим Z

### Источник
[[Исходный-PDF-документ]] (стр. 15)
```

#### `src/services/generation/canvas-generator.ts`

```typescript
export class CanvasGenerator {
  constructor(private _nikelDir: string) {}

  async generateCluster(entityId: string, graph: KnowledgeGraph): Promise<CanvasContent>
  // BFS от entityId на depth=1
  // Каждая entity → node (file ссылка на .md)
  // Каждая relation → edge с label

  async generateGlobalOverview(graph: KnowledgeGraph, limit?: number): Promise<CanvasContent>
  // Топ-N сущностей по количеству связей
  // Раскладывает в grid или force-directed layout

  async generateTimeline(entities: Entity[], relations: Relation[]): Promise<CanvasContent>
  // Только эксперименты с датами
  // Раскладывает горизонтально: хронология
}
```

**Правила генерации `.canvas`:**

```json
{
  "nodes": [
    {
      "id": "entity-id",
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 150,
      "type": "file",
      "file": "nikel/materials/Сплав-X.md",
      "label": "Сплав-X"
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "from": "entity-from",
      "to": "entity-to",
      "label": "связь",
      "fromSide": "right",
      "toSide": "left"
    }
  ]
}
```

#### `src/services/generation/index-generator.ts`

```typescript
export class IndexGenerator {
  constructor(private _nikelDir: string) {}

  async generateIndex(manifest: IndexManifest): Promise<string>
  // _index.md — полный каталог всех сущностей по категориям:
  /**
   * # База знаний Nikel
   * 
   * ## Материалы (12)
   * - [[nikel/materials/Сплав-X]]
   * - [[nikel/materials/Сплав-Y]]
   * 
   * ## Эксперименты (48)
   * - [[nikel/experiments/exp-001]]
   * - ...
   */

  async generateGraphMermaid(manifest: IndexManifest): Promise<string>
  // _graph.md — Mermaid diagram всех связей
  /**
   * ```mermaid
   * graph LR
   *   exp-001 --> |материал| mat-001
   *   exp-001 --> |свойство| prop-001
   * ```
   */
}
```

---

## 7. Изменения в существующих файлах

### `src/types.ts`

Добавить:
- Все типы из секции 4
- В `NikelSettings`: `pdfFolder: string`, `nikelDir: string`
- В `DEFAULT_SETTINGS`: `pdfFolder: ""`, `nikelDir: "nikel"`

### `src/main.ts`

Добавить:
- `pdfExtractor: PdfExtractor`
- `entityExtractor: EntityExtractor`
- `fileWatcher: FileWatcher`
- `graph: KnowledgeGraph`
- `queryEngine: QueryEngine`
- `mdGenerator: MdGenerator`
- `canvasGenerator: CanvasGenerator`
- `indexGenerator: IndexGenerator`

Новые методы:
- `runIndexing()` — полный цикл, вызывается из команды
- `initKnowledgeGraph()` — загрузка index.json при старте

Новая команда:
```typescript
this.addCommand({
  id: "nikel-index-pdfs",
  name: "Индексировать PDF-папку",
  callback: () => this.runIndexing(),
})
```

Модифицировать `processNikelTask()`:
```
if (this.settings.pdfFolder && graph загружен) {
  // Новый flow: → queryEngine → md-generator → новый .md ответ
} else {
  // Старый flow: inline-вставка
}
```

### `src/settings/settings-tab.ts`

Добавить:
- Поле "PDF-папка" — текстовое, с выбором через Obsidian API
- Поле "Папка генерации" — `nikel/` по умолчанию
- Кнопка "Индексировать сейчас" → `plugin.runIndexing()`
- Кнопка "Статус индекса" → показывает статистику из графа

---

## 8. Структура сгенерированных документов

```
vault/
├── nikel/
│   ├── _index.md                         # авто-оглавление
│   ├── _graph.md                         # Mermaid-диаграмма
│   ├── materials/
│   │   ├── Сплав-X.md
│   │   └── Сплав-Y.md
│   ├── experiments/
│   │   ├── exp-001-влияние-режима-Y.md
│   │   └── exp-005-сплав-X-при-800C.md
│   ├── equipment/
│   │   └── Установка-001.md
│   ├── teams/
│   │   └── Лаборатория-имени-Т.md
│   ├── properties/
│   │   └── Прочность.md
│   ├── modes/
│   │   └── Режим-Y.md
│   ├── topics/
│   │   └── Турбинные-сплавы.md
│   ├── chronology/
│   │   └── 2024.md
│   ├── canvas/
│   │   ├── кластер-сплав-X.canvas
│   │   └── обзор-базы-знаний.canvas
│   └── _answers/
│       └── 2024-03-15-103000.md          # ответы @nikel_s
├── .nikel/
│   ├── index.json                        # весь граф
│   └── file-hashes.json                  # MD5 хеши PDF
```

---

## 9. План тестов (35+ новых)

| Сервис | Файл тестов | Тестов | Ключевые кейсы |
|--------|-------------|--------|----------------|
| PdfExtractor | `tests/services/ingestion/pdf-extractor.test.ts` | 10+ | Рендер страницы, Vision вызов, агрегация, пустой PDF, ошибка pdfjs |
| EntityExtractor | `tests/services/ingestion/entity-extractor.test.ts` | 10+ | Извлечение из markdown, normalizeName, dedup, дубликаты, пустой документ |
| FileWatcher | `tests/services/ingestion/file-watcher.test.ts` | 6+ | Новые/изменённые/удалённые файлы, пустая папка, кривой JSON |
| KnowledgeGraph | `tests/services/graph/knowledge-graph.test.ts` | 15+ | addEntity, addRelation, findEntities, mergeIndex, dedup, BFS cluster, persist |
| QueryEngine | `tests/services/graph/query-engine.test.ts` | 8+ | Извлечение сущностей из вопроса, пустой результат, несколько сущностей, ошибка LLM |
| MdGenerator | `tests/services/generation/md-generator.test.ts` | 10+ | Frontmatter, [[links]], #tags, Dataview, пустые поля, стилизация |
| CanvasGenerator | `tests/services/generation/canvas-generator.test.ts` | 6+ | Cluster, overview, timeline, пустой граф |
| IndexGenerator | `tests/services/generation/index-generator.test.ts` | 4+ | _index.md, _graph.md Mermaid |
| Main (доп.) | `tests/services/main.test.ts` | 4+ | @nikel_s с графом, ошибка графа, пустой контекст |

---

## 10. Порядок реализации

### Фаза 1 — Ядро индексации

1. `src/types.ts` — добавить все новые типы и поля настроек
2. `src/services/ingestion/file-watcher.ts` + тесты
3. `src/services/ingestion/pdf-extractor.ts` + тесты
4. `src/services/ingestion/entity-extractor.ts` + тесты
5. `src/services/graph/knowledge-graph.ts` + тесты
6. `src/services/graph/query-engine.ts` + тесты
7. `src/main.ts` — команда "Индексировать PDF-папку"
8. `src/settings/settings-tab.ts` — поле PDF-папки, кнопка индексации

**Критерий готовности:** `npm test` проходит, можно указать папку с PDF, нажать "Индексировать", получить `index.json` с entities + relations.

### Фаза 2 — Генерация документов

9. `src/services/generation/md-generator.ts` + тесты
10. `src/services/generation/canvas-generator.ts` + тесты
11. `src/services/generation/index-generator.ts` + тесты
12. `src/main.ts` — после индексации авто-генерация .md и .canvas
13. `src/main.ts` — @nikel_s создаёт новый .md документ с контекстом из графа

**Критерий готовности:** После индексации в `nikel/` появляются .md с [[links]] и .canvas. @nikel_s отвечает из графа.

### Фаза 3 — Доводка

14. Прогресс-бары, уведомления, кнопка "Прервать"
15. Интеграционные тесты (mock Ollama Vision)
16. Обработка edge cases (пустая папка, ошибка pdfjs, нет места на диске)
17. README, AGENTS.md — финальная актуализация

---

## 11. Риски и mitigation

| Риск | Вероятность | Влияние | Решение |
|------|-------------|---------|---------|
| PDF 500+ страниц — тысячи Vision вызовов | Средняя | Высокое | Parallelism=2, прогресс в Notice, кнопка отмены |
| Ollama Vision теряет контекст между страницами | Высокая | Среднее | Повторный LLM-проход: сквозная агрегация каждой группы страниц |
| Дубликаты (Сплав-Х / Сплав X) | Высокая | Среднее | normalizeName + fuzzy dedup в KnowledgeGraph.mergeIndex() |
| JSON index >50MB | Низкая | Среднее | Инкрементальная запись (append-only лог + compact). SQLite если вырастет |
| Obsidian UI фризится | Средняя | Высокое | async везде, chunked processing (requestIdleCallback/yield) |
| gemma4:e4b не справляется с качеством Vision | Низкая | Среднее | В настройках можно сменить на gemma4:12b (лучший Vision бенчмарк) |
| pdfjs-dist конфликтует с Obsidian | Низкая | Высокое | Fallback: `pdfjs-dist/legacy/build/pdf` (без модулей) |
| Ошибка при записи index.json | Низкая | Среднее | Транзакционная запись: write → .tmp → rename |
| Пользователь удалил PDF после индексации | Средняя | Низкое | FileWatcher замечает deleted, md-generator добавляет #архивировано |

---

## 12. @nikel_s с графом — детальная логика

```
@nikel_s что делали по сплаву X при режиме Y?
    │
    ▼
┌──────────────────────────────────────────┐
│ QueryEngine.answerQuestion("что делали..")│
└────────────────┬─────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │ 1. LLM: extractEntities │
    │    ["Сплав-X", "Режим-Y"]│
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ 2. graph.findEntities() │
    │    → mat-001 (Сплав-X)  │
    │    → mode-001 (Режим-Y) │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ 3. graph.findRelated()  │
    │    mat-001 → exp-001,   │
    │           → exp-005     │
    │    mode-001 → exp-001   │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ 4. buildContext()       │
    │ ## Найденные факты      │
    │ [[Сплав-X]]:            │
    │  - [[exp-001]]: 450 МПа│
    │  - [[exp-005]]: 320 HV │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ 5. Ollama(context + Q)  │
    │    → ответ с [[ссылками]]│
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ 6. md-generator.create  │
    │    _answers/...md       │
    │    с frontmatter        │
    └────────────┬────────────┘
                 │
    ▼
Новый документ в Obsidian:
---
type: answer
question: что делали по сплаву X при режиме Y?
sources: [nikel/experiments/exp-001.md, ...]
---

## Ответ

По сплаву [[Сплав-X]] в режиме [[Режим-Y]] был проведён
эксперимент [[exp-001]], показавший увеличение
[[Прочность|прочности]] на 12% (450 МПа).
```
