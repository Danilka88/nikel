# AGENTS.md — для AI-агентов (opencode / Deepseek V4 Flash)

Этот файл описывает архитектуру, конвенции и правила разработки плагина **Nikel** для Obsidian. Следуй этим инструкциям при внесении изменений, чтобы сохранить качество и согласованность кода.

## 1. Архитектура

**Принцип:** тонкий слой Obsidian (main.ts) + чистые сервисы без зависимостей от Obsidian.

```
main.ts (оркестрация, вызовы Obsidian API)
  ├── utils.ts                     — resolvePdfMode(), toErrorMessage(), getSubDir(), safeFileName(), detectSourceType()
  ├── ui/
  │   └── progress-modal.ts        — ProgressModal (индексация)
  ├── services/
  │   ├── ingestion/
  │   │   ├── pdf-extractor.ts     — PDF → PNG/Text → Ollama Vision → Markdown (fast/vision ветвление)
  │   │   ├── pdf-renderer.ts      — DefaultPdfRenderer (pdfjs-dist v4.10.38 → PNG + getTextContent)
  │   │   ├── text-extractor.ts    — TextExtractor: .txt (TextDecoder) / .docx (mammoth) → Markdown
  │   │   ├── entity-extractor.ts  — Markdown → сущности + связи JSON
  │   │   ├── document-store.ts    — TextChunk[] (чанкинг 1000/200, keyword search, save/load)
  │   │   └── file-watcher.ts      — хеши файлов (MD5), TOCTOU-safe, инкрементальная индексация
  │   ├── graph/
  │   │   ├── knowledge-graph.ts   — граф сущностей, merge, dedup, persistence, removeBySource
  │   │   └── query-engine.ts      — поиск по графу для @nikel_s (extractEntities + answer)
  │   ├── generation/
  │   │   ├── md-generator.ts      — сущность → .md (frontmatter ручной YAML, [[links]], Dataview)
  │   │   ├── canvas-generator.ts  — кластер → .canvas (radial/grid/timeline layout)
  │   │   └── index-generator.ts   — _index.md (каталог), _graph.md (Mermaid LR)
  │   ├── log-service.ts           — FileLogger (лог-файл, ring buffer 500, debounced flush)
  │   ├── ollama.ts                — HTTP к Ollama (injectable fetch, escalating timeout, retry, localhost→127.0.0.1)
  │   ├── trigger-parser.ts        — чистая функция: поиск триггера @nikel_* + сборка промпта
  │   └── response-formatter.ts    — чистая функция: форматирование ответа (TEMPLATE_RE)
  ├── suggester.ts                 — EditorSuggest для автокомплита @nik
  └── settings/settings-tab.ts     — вкладка настроек
```

**Директории на диске** (внутри vault, по умолчанию `nikel/`):
- `nikel/materials/`, `nikel/experiments/`, `nikel/properties/`, `nikel/modes/`, `nikel/equipment/`, `nikel/teams/`, `nikel/persons/`, `nikel/conclusions/`, `nikel/topics/`, `nikel/publications/`, `nikel/processes/`, `nikel/facilities/` — сгенерированные .md сущностей (маппинг entity type → подпапка через `getSubDir()`)
- `nikel/_answers/` — ответы @nikel_s (YYYY-MM-DD-HHmmss.md)
- `nikel/canvas/` — .canvas файлы (обзор-базы-знаний.canvas, хронология.canvas, кластер-*.canvas)
- `nikel/.nikel/file-hashes.json` — хеши всех файлов (FileWatcher, абсолютные пути)
- `nikel/.nikel/nikel.log` — лог действий и ошибок (FileLogger, ring buffer 500 строк, debounced append)
- `nikel/.nikel/document-store.json` — DocumentStore (прямой режим, TextChunk[])
- `nikel/_log-export.md` — экспорт лога для отправки AI (создаётся кнопкой в настройках)
- `nikel/index.json` — граф знаний (KnowledgeGraph, транзакционная запись)

Тип источника детектируется автоматически по имени подпапки через `detectSourceType()`.

## 2. Конвенции кода

### 2.1 Общие

- **Язык:** TypeScript, strict mode (`strict: true`, `strictNullChecks: true`)
- **Форматирование:** пробелы, отступ 2, без точек с запятой
- **Длина строки:** нет жёсткого лимита, но избегать строк > 120 символов
- **Именование:**
  - camelCase для функций, переменных, методов
  - PascalCase для типов, интерфейсов, классов
  - kebab-case для файлов
- **Модификаторы доступа:** приватные поля с префиксом `_` (например, `_ollama`, `_buffer`)
- **Комментарии:** НЕ добавлять комментарии к коду. Код должен быть самодокументируемым.

### 2.2 Импорты

- Сначала импорты из Obsidian (всегда отдельной группой)
- Затем внутренние модули (относительные пути, без `index.ts`)
- Сортировать по алфавиту внутри групп
- Для импорта типа — `import type { X }` или `import { type X }` (TypeScript 5+)

### 2.3 Типы

- Все публичные интерфейсы — в `src/types.ts`
- Локальные типы — рядом с использованием, не экспортируются (`ChatMessage` — неэкспортирован)
- Не использовать `any`. Если тип неизвестен — `unknown`.
- `Editor` из Obsidian и `TriggerMatch` из types.ts — везде типизированы (не any)
- `PdfPageRenderer._doc` — `PDFDocumentProxy | null` (из `"pdfjs-dist"`)
- `page.getTextContent().items` — фильтр `"str" in item + as { str: string }` (часть items — `TextMarkedContent` без str)
- `OllamaClient` — интерфейс для injectable-архитектуры (позволяет мокать fetch)
- При JSON.parse всегда добавлять рантайм-валидацию (Array.isArray, typeof checks)
- `Record<string, unknown>` предпочтительнее `as any` при парсинге JSON

### 2.4 Сервисы (чистые функции)

Каждый сервис в `src/services/` должен:
- Иметь **нулевую зависимость от Obsidian API**
- Быть **чистой функцией** (одинаковый вход → одинаковый выход, без side-эффектов)
- Иметь **≥80% покрытие тестами**
- Экспортировать либо функцию, либо класс с injectable-зависимостями

### 2.5 Обработка ошибок

- Ошибки API — `throw Error` с человекочитаемым сообщением
- В `main.ts` ошибки ловятся в `try/catch` и показываются через `new Notice()`
- **Все catch блоки** используют `toErrorMessage(e)` (из `utils.ts`) — никогда `(e as Error).message`
- Пользовательские уведомления — только на русском языке (для команды)
- Сетевые ошибки Ollama — retry 1 раз + fallback localhost→127.0.0.1, timeout 120s
- `isRetryable(err)` ретраит `TypeError` и `DOMException AbortError`
- `enhanceError()` — оборачивает сырые ошибки в русский текст с инструкциями

## 3. Типы (src/types.ts)

### 3.1 Полный список интерфейсов (все экспортированы)

| Интерфейс | Поля |
|-----------|------|
| `NikelCommand` | `trigger: string`, `description: string`, `promptTemplate: string`, `enabled: boolean` |
| `NikelSettings` | `ollamaUrl: string`, `model: string`, `commands: NikelCommand[]`, `pdfFolder: string`, `txtFolder: string`, `docxFolder: string`, `nikelDir: string`, `indexingMode: IndexingMode` |
| `TriggerMatch` | `line: number`, `command: NikelCommand`, `input: string` |
| `GenerateOptions` | `prompt: string`, `model: string`, `url: string`, `signal?: AbortSignal`, `timeoutMs?: number` |
| `ChatOptions` | `messages: ChatMessage[]`, `model: string`, `url: string`, `signal?: AbortSignal`, `timeoutMs?: number` |
| `OllamaClient` | `generate(opts): Promise<string>`, `chat(opts): Promise<string>`, `listModels(url): Promise<string[]>` |
| `Entity` | `id, name, type, aliases, properties, tags, source, sourcePage?, context?, confidence?, geography?, year?, sourceType?, createdAt, updatedAt` |
| `Relation` | `from: string`, `to: string`, `type: RelationType`, `context?: string` |
| `IndexManifest` | `version: number`, `lastIndexed: string`, `files: Record<string, string>`, `entities: Entity[]`, `relations: Relation[]` |
| `PdfExtractResult` | `markdown: string`, `pageCount: number`, `pages: string[]` |
| `TextChunk` | `sourcePath: string`, `pageNum: number`, `chunkIndex: number`, `text: string` |
| `ExtractionResult` | `entities: Entity[]`, `relations: Relation[]` |
| `SearchFilters` | `text?: string`, `types?: EntityType[]`, `geography?, yearMin?, yearMax?, confidence?, tags?: string[]`, `numericParams?: { name, operator ("lt"\|"lte"\|"gt"\|"gte"\|"eq"), value, unit? }[]` |
| `FileChanges` | `newFiles: string[]`, `changedFiles: string[]`, `deletedFiles: string[]`, `unchangedFiles: string[]` |
| `QueryResult` | `answer: string`, `contextMd: string`, `linkedDocs: string[]` |
| `DocContent` | `path: string`, `content: string`, `frontmatter: Record<string, unknown>` |
| `CanvasNode` | `id, x, y, width, height, type: "file", file, label` |
| `CanvasEdge` | `id, from, to, label, fromSide?, toSide?` |
| `CanvasContent` | `path, nodes: CanvasNode[], edges: CanvasEdge[]` |
| `Logger` | `info(msg, context?), warn(msg, context?), error(msg, context?), clear(version?), getLogContent(): string` |

### 3.2 Неэкспортированные интерфейсы
- `ChatMessage` — `role: "system" | "user" | "assistant"`, `content: string`, `images?: string[]`

### 3.3 Типы-алиасы

| Алиас | Значения |
|-------|----------|
| `EntityType` | `material, experiment, property, mode, equipment, team, person, conclusion, topic, publication, process, facility` (12) |
| `RelationType` | `uses_material, has_property, in_mode, uses_equipment, conducted_by, leads_to, related_to, precedes, described_in, operates_at_condition, produces_output, validated_by, contradicts` (13) |
| `IndexingMode` | `"vision"`, `"fast"`, `"direct"` (3) |

### 3.4 DEFAULT_SETTINGS

```typescript
{
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  pdfFolder: "",
  txtFolder: "",
  docxFolder: "",
  nikelDir: "nikel",
  indexingMode: "vision",
  commands: [
    { trigger: "@nikel_s", description: "Отправить задачу модели",
      promptTemplate: "...с контекстом... {{input}}", enabled: true },
    { trigger: "@nikel_f", description: "Исправить форматирование и грамматику",
      promptTemplate: "...исправь... {{input}}", enabled: true },
  ],
}
```

Два предустановленных триггера: `@nikel_s` (с контекстом базы знаний) и `@nikel_f` (только форматирование).

### 3.5 createEmptyManifest()

Возвращает `IndexManifest` с `version: 1`, `lastIndexed: now().toISOString()`, пустыми `files`, `entities`, `relations`.

## 4. Структура тестов

- **Фреймворк:** vitest v4
- **Конфиг:** `vitest.config.ts` — alias `obsidian → tests/__mocks__/obsidian.ts`
- **Расположение:** `tests/services/*.test.ts` (один файл на один сервис)
- **Всего:** 18 test-файлов, 165 тестов

### 4.1 Mock Obsidian (tests/__mocks__/obsidian.ts)

| Класс | Методы/свойства | Назначение |
|-------|----------------|------------|
| `Plugin` | `app`, `manifest`, `loadData()→{}`, `saveData()`, `registerEditorSuggest()`, `addCommand()`, `addSettingTab()` | Базовая заглушка плагина |
| `MarkdownView` | `editor` | Заглушка вьюхи |
| `PluginSettingTab` | `app`, `plugin`, `containerEl` | Заглушка вкладки |
| `Setting` | Fluent builder: `setName()→this`, `setDesc()→this`, `addText(fn)`, `addButton(fn)` и т.д. | Fluent UI builder |
| `Modal` | `app`, `titleEl`, `contentEl` (реальные HTMLElement), `open()`, `close()` | Заглушка модалки |
| `Notice` | **`static lastMessage: string \| null`**, **`static calls: string[]`**, `message` | Глобальное состояние для assertions |
| `TFile` | `path: string` | Простейшая заглушка файла |
| `EditorSuggest<T>` | `app`, `context`, `register()`, `suggestSelected()`, `close()` | Заглушка саджестера |

**Notice mock:** позволяет проверять уведомления: `expect(Notice.lastMessage).toContain("...")` или `Notice.calls[0]`.

### 4.2 Правила тестирования

1. Каждый сервис — отдельный test-файл
2. Каждый test-файл содержит describe-блоки: по одному на экспортируемую функцию/метод
3. Каждый кейс — атомарный `it()` с понятным названием на русском
4. Тесты не должны требовать запущенного Ollama или Obsidian
5. В тестах `main.ts` обязательно мокать `Notice.lastMessage` для проверки уведомлений
6. PdfExtractor тесты мокают `PdfPageRenderer` — не используют реальный pdfjs
7. Ollama тесты передают `mockFetch = vi.fn()` в конструктор `DefaultOllamaClient(mockFetch)`
8. Main.test.ts мокает все сервисы (ollama, KnowledgeGraph, logger и т.д.)

### 4.3 Покрытие

| Модуль | Файл тестов | Количество тестов |
|--------|------------|-------------------|
| `trigger-parser` | `trigger-parser.test.ts` | 13 |
| `response-formatter` | `response-formatter.test.ts` | 6 |
| `ollama` | `ollama.test.ts` | 20 |
| `suggester` | `suggester.test.ts` | 9 |
| `main` | `main.test.ts` | 11 |
| `pdf-extractor` | `pdf-extractor.test.ts` | 12 |
| `text-extractor` | `text-extractor.test.ts` | 4 |
| `document-store` | `document-store.test.ts` | 10 |
| `entity-extractor` | `entity-extractor.test.ts` | 9 |
| `file-watcher` | `file-watcher.test.ts` | 5 |
| `knowledge-graph` | `knowledge-graph.test.ts` | 23 |
| `query-engine` | `query-engine.test.ts` | 3 |
| `md-generator` | `md-generator.test.ts` | 8 |
| `canvas-generator` | `canvas-generator.test.ts` | 6 |
| `index-generator` | `index-generator.test.ts` | 5 |
| `log-service` | `log-service.test.ts` | 7 |
| `utils` | `utils.test.ts` | 10 |
| pdf-renderer (integration) | `tests/integration/pdf-renderer.test.ts` | 4 |
| `settings-tab` | — | UI-компонент, не тестируется |
| `pdf-renderer` | — | требует реального PDF |
| `progress-modal` | — | UI-компонент |

### 4.4 Mock fetch pattern

```typescript
const mockFetch = vi.fn()
const client = new DefaultOllamaClient(mockFetch)
mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: { content: "ответ" } })))
```

Не использовать глобальные mock-fetch библиотеки; передавать в конструктор.

## 5. Процесс сборки

```bash
npm run build     # esbuild → main.js (CommonJS bundle, ~1.9MB с pdfjs-dist v4.10.38 + mammoth)
npm run test      # vitest run
npx tsc --noEmit  # type check (strict mode)
npm run dev       # esbuild в режиме watch
```

- `main.js` — единственный выходной файл, коммитится в репозиторий
- `esbuild.config.mjs` использует `external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "builtinModules"]` — Obsidian API и Node builtins не бандлятся
- `pdfjs-dist` и `mammoth` — НЕ в external, бандлятся в main.js
- Перед добавлением нового npm-пакета: проверить, что это pure JS (не native). Native модули не работают в Obsidian плагинах.
- При изменении `tsconfig.json` убедись, что `include` покрывает `src/` и `tests/`

## 6. Расширение функционала

### 6.1 Новая команда

1. Добавить запись в `DEFAULT_SETTINGS.commands` в `types.ts`
2. Тесты `trigger-parser.test.ts` и `suggester.test.ts` уже покрывают generic-кейсы — новые тесты не обязательны, если логика не меняется

### 6.2 Новый сервис

1. Создать файл в `src/services/`
2. Экспортировать чистую функцию или класс с injectable-зависимостями
3. Написать тесты в `tests/services/`
4. Использовать в `main.ts`
5. Добавить инициализацию в `initKnowledgeGraphServices()`

### 6.3 Новая настройка

1. Добавить поле в `NikelSettings` в `types.ts`
2. Добавить UI-элемент в `NikelSettingTab.display()`
3. Использовать в `main.ts` через `this.settings`
4. Если настройка влияет на сервисы — передать её в конструктор или через init

### 6.4 Другая LLM (вместо Ollama)

1. Реализовать интерфейс `OllamaClient` из `types.ts`
2. Подставить в `main.ts` вместо `DefaultOllamaClient`
3. Тесты для старого клиента остаются, для нового — свои

### 6.5 Knowledge Graph

#### 6.5.1 Текущая онтология

**12 типов сущностей:** material, experiment, property, mode, equipment, team, person, conclusion, topic, publication, process, facility

**13 типов связей:** uses_material, has_property, in_mode, uses_equipment, conducted_by, leads_to, related_to, precedes, described_in, operates_at_condition, produces_output, validated_by, contradicts

**Метаданные Entity:** confidence (high/medium/low), geography (ru/foreign/both), year, sourceType (article/report/patent/conference/review/dissertation/other)

#### 6.5.2 Новый тип сущности

1. Добавить значение в `EntityType` в `types.ts`
2. Добавить тип в `entity-extractor.ts` — prompt для LLM + `VALID_ENTITY_TYPES` Set
3. Добавить в `TYPE_DIR_MAP` в `utils.ts` (подпапка для .md)
4. Тип появится в `TYPE_LABELS` (index-generator) и Dataview полях автоматически
5. Добавить русскую метку в `TYPE_LABELS` в index-generator.ts

#### 6.5.3 Новый тип связи

1. Добавить значение в `RelationType` в `types.ts`
2. Добавить в `entity-extractor.ts` prompt + `VALID_RELATION_TYPES` Set
3. Добавить в `relFieldMap` в `md-generator.ts` — Dataview-поле для этого типа связи
4. Если связь влияет на layout canvas → canvas-generator.ts

#### 6.5.4 Индексация (runIndexing) — полный поток

```
runIndexing() → guard (isIndexing) + try/finally → _doIndexing()
  ↓
fileWatcher.scan(folder, exts) → MD5 сравнение для каждой папки (pdf/txt/docx)
  ↓ (если changes.length === 0 → return)
graph.load() / documentStore.load()
  ↓
Обработка deletedFiles:
  - direct: documentStore.removeBySource(filePath)
  - graph:   graph.removeBySource(filePath)   ← фикс Batch 5
  ↓
Для каждого нового/изменённого файла:
  fs.readFile() → Uint8Array.from(raw) → extract (pdf/txt/docx)
  ↓
  direct mode: documentStore.addDocument(sourcePath, markdown, pageNum)
  graph mode:  entityExtractor.extract(md) → Entity[] + Relation[]
               detectSourceType(relPath) → entity.sourceType
               graph.mergeIndex(...) → dedup + merge
  ↓
  В случае ошибки файла: continue (не fatal), лог ERROR
  ↓
hashManifest: если successfullyProcessed пуст → использует processedFiles
fileWatcher.updateFileHashes() + removeFileHashes()
graph.save() / documentStore.save() (write → .tmp → rename)
  ↓
Генерация .md для каждой entity (не перезаписывает существующие)
Генерация _index.md, _graph.md, обзор-базы-знаний.canvas
  ↓
ProgressModal с <progress> и названием текущего файла
```

Правила:
- Всегда инкрементальная (по MD5 хешам)
- Всегда транзакционная (write → .tmp → rename)
- Никогда не удалять пользовательские документы в `nikel/` при переиндексации
- Если LLM вернула некорректный JSON — пропустить файл, ошибка логируется
- При повреждении `index.json` → создаётся `index.json.bak`

## 7. Knowledge Graph System — правила

### 7.1 Injection

| Сервис | Конструктор |
|--------|-------------|
| `PdfExtractor` | `OllamaClient` + `PdfPageRenderer` + `Logger?` |
| `EntityExtractor` | `OllamaClient` + `{ model, url }` |
| `KnowledgeGraph` | `manifestPath: string` (путь к index.json) |
| `QueryEngine` | `KnowledgeGraph` + `OllamaClient` + `{ model, url }` |
| `MdGenerator` | `nikelDir: string` |
| `CanvasGenerator` | `nikelDir: string` + `vaultRelDir: string` |
| `IndexGenerator` | `nikelDir: string` |
| `FileWatcher` | `nikelDir: string` |
| `DocumentStore` | `nikelDir: string` |
| `FileLogger` | `nikelDir: string` |

### 7.2 Entity Extraction

- LLM возвращает строгий JSON — валидация схемы через type guard (`isValidExtraction`)
- **Runtime валидация типов:** `VALID_ENTITY_TYPES` (Set, 12 типов) / `VALID_RELATION_TYPES` (Set, 13 типов)
- Если JSON невалидный → retry 1 раз
- Если повторно невалидный → throw Error с сырым ответом LLM
- **Entity с неизвестным типом:** flatMap → return [] (тихо пропускаются)
- **Properties coercion:** `Object.fromEntries(Object.entries(...).map(([k, v]) => [k, String(v ?? "")]))` — все значения приводятся к строке (фикс Batch 5)
- **Empty relations:** `if (!from || !to) return []` — пустые from/to фильтруются (фикс Batch 5)
- `extractJson(raw)` — greedy regex `\{[\s\S]*\}`: находит первый `{` до последнего `}`. Риск: если LLM вернёт несколько объектов, захватит всё до последней `}`. Принято, т.к. prompt просит "ТОЛЬКО JSON".
- `normalizeName()` — обязательный вызов перед dedup. Pipeline: lowercase → trim → whitespace→hyphen → удаление не-[a-zа-яё0-9-] → схлопывание дефисов → обрезка ведущих/конечных дефисов.
- `dedupEntities()` — merge по `"${type}:${normalizeName(name)}"`. При дубликате: merge aliases (Set), properties (spread, last wins), tags (concat+dedup), sourcePage/confidence/geography/year/sourceType (new ?? existing), context (append), updatedAt.

### 7.3 KnowledgeGraph — полный API

| Метод | Описание |
|-------|----------|
| `load()` | Читает index.json. SyntaxError → `.bak` + пустой манифест |
| `save()` | mkdir → write .tmp → rename |
| `addEntity(entity)` / `addRelation(relation)` | Добавляет в массивы |
| `deleteEntity(id)` | Удаляет entity + все relations (from/to) |
| `getEntity(id)` | Поиск по id |
| `getEntityByName(name, type?)` | normalizeName + name/aliases match, опционально по type |
| `findEntities(type?, query?)` | Фильтр по type + substring name/aliases/tags |
| `findRelated(entityId, relationType?)` | Relations где entity = from или to |
| `search(text)` | Full-text: name/aliases/context/tags → matching entities + их relations |
| `searchFiltered(filters)` | Многоуровневый фильтр: text + types + geography + yearMin/Max + confidence + tags + numericParams. Все optional поля — в локальные переменные до filter, без `!` |
| `mergeIndex(manifest)` | Dedup + merge сущностей (type+name) и relations (from+to+type) |
| `buildCluster(entityId, depth=1)` | BFS до depth уровней, visited Set защита от циклов |
| `removeBySource(sourcePath)` | Удаляет все entity с `source === sourcePath` и их relations (фикс Batch 5) |
| `getStats()` | `{ entityCount, relationCount, fileCount }` (fileCount = уникальные source) |

### 7.4 Query Engine

- Всегда возвращает `QueryResult` — даже если ничего не найдено (contextMd = "В графе нет информации...")
- `extractEntities(question)`: LLM → JSON-массив строк. **Runtime guard:** `Array.isArray` после JSON.parse (фикс Batch 6)
- `searchFiltered` по каждому извлечённому имени
- `buildContext()`: `[[link|name]]` формат + relations с типом и контекстом
- `generateAnswer()`: шаблон `ANSWER_PROMPT` с подстановкой `{contextMd}` и `{question}`
- `answerQuestion(question, filters?)` — опциональный `SearchFilters`

### 7.5 MD Generation

**relFieldMap** — маппинг 13 relation types → Dataview-поля:

| Relation type | Dataview field |
|---------------|----------------|
| `uses_material` | `material` |
| `has_property` | `property` |
| `in_mode` | `mode` |
| `uses_equipment` | `equipment` |
| `conducted_by` | `team` |
| `leads_to` | `conclusion` |
| `related_to` | `related` |
| `precedes` | `precedes` |
| `described_in` | `source` |
| `operates_at_condition` | `condition` |
| `produces_output` | `output` |
| `validated_by` | `validated` |
| `contradicts` | `contradicts` |

**buildFrontmatter()** — ручной YAML-сериализатор (без external-зависимостей):
- Null/undefined → skip
- Пустые массивы → skip
- Массивы: элементы с пробелами → `"${v}"`
- Строки с `:`, `#`, `\n`, `[[`, `]]` → double-quoted с экранированием `"`
- Объекты → multi-line YAML (ключ на родителе, `  k: v` внутри)
- Числа/boolean → `key: ${val}` unquoted

**generateAnswerDoc()**:
- Имя файла: `_answers/YYYY-MM-DDTHH-mm-ss.md` (ISO без :.)
- Frontmatter: `type: answer`, `question`, `sources: linkedDocs[]`, `model`, `created`
- Body: `## Ответ на: ${question}` + answer + context (если есть) + sources (если есть)

### 7.6 Canvas Generation

| Метод | Описание | Layout |
|-------|----------|--------|
| `generateGlobalOverview(graph)` | Первые 50 entity, фильтр relations по entityIds | Grid: `ceil(sqrt(N))` колонок |
| `generateCluster(entityId, graph)` | `graph.buildCluster(id, 1)` → 1-hop neighborhood | Radial: центр фиксирован (500,300), остальные по кругу R=250 |
| `generateTimeline(entities, relations)` | Фильтр `experiment`, сортировка по date/createdAt | Horizontal: START_X + i*GAP_X, consecutive edges "→" |

**Константы layout:** NODE_WIDTH=300, NODE_HEIGHT=150, START_X=100, START_Y=100, GAP_X=400, GAP_Y=250, MAX_NODES_OVERVIEW=50

Edge labels: `r.context || r.type`. Node type всегда `"file"` (не text).

### 7.7 Index Generation

**TYPE_LABELS** — 12 русских меток: Материалы, Эксперименты, Свойства, Режимы, Оборудование, Команды, Исследователи, Выводы, Темы, Публикации, Процессы, Установки и площадки.

**generateIndex(manifest):** Markdown с frontmatter (type, description, updated, counts) + секции по типам:
- `## ${TYPE_LABELS[type]} (count)`
- `- [[nikelDir/subDir/safeName.md]] #tag1 #tag2`

**generateGraphMermaid(manifest):** `graph LR` с dedup рёбер (Set `"${from}|${to}|${type}"`) + легенда типов.
- `toMermaidId(id)`: replaces non-alphanumeric with `_`

## 8. Утилиты (src/utils.ts)

```typescript
resolvePdfMode(mode: IndexingMode): "vision" | "fast"
  // "direct" → "fast", иначе как есть (bridge 3→2 значений)

toErrorMessage(e: unknown): string
  // e instanceof Error ? e.message : String(e)

getSubDir(type: string): string
  // material→"materials", ...неизвестно→"other"

safeFileName(name: string): string
  // sanitize: удаление /\:*?"<>|, whitespace→hyphen, trim, fallback "unnamed"

detectSourceType(relPath: string): Entity["sourceType"]
  // "Статьи/..." → "article", иначе "other"
```

**TYPE_DIR_MAP** (12 записей): `material→materials, experiment→experiments, property→properties, mode→modes, equipment→equipment, team→teams, person→persons, conclusion→conclusions, topic→topics, publication→publications, process→processes, facility→facilities`. `equipment` = irregular plural (same form).

**SOURCE_FOLDER_MAP** (русские имена подпапок → sourceType): доклады→report, журналы→article, материалы конференций/конференция/конференции→conference, обзоры→review, статьи→article, патенты→patent, диссертации→dissertation. Неизвестное → "other".

## 8 UI (src/ui/)

### 8.1 ProgressModal

- `new ProgressModal(app, title)` — модальное окно с `<progress>` и текстовой меткой
- `setProgress(current, total, label?)` — обновляет прогресс и подпись
- Автоматически закрывается по `modal.close()`
- Используется в `runIndexing()` для отображения прогресса по файлам

## 9. Важные детали реализации

### 9.1 OllamaClient

- `generate(opts)` — `/api/generate` (старый API, prompt-based), валидация `typeof data.response === "string"`
- `chat(opts)` — `/api/chat` (messages-based, `images[]` для Vision), валидация `data.message?.content`
- `listModels(url)` — `/api/tags`, `fetchWithTimeout` (120s)
- **Таймаут:** AbortController + setTimeout. Если `opts.signal` передан — использует его, иначе создаёт свой с `timeoutMs ?? 120_000`
- **Валидация ответа:** generate() — `typeof data.response === "string"`; chat() — `data.message?.content`; при невалидном — `data.error || generic`
- **Очистка таймера:** `finally { timeout?.clear() }`
- **Retry:** `fetchWithFallback()` — 1 попытка при TypeError (сеть) или AbortError (таймаут). После исчерпания retry: если `isLocalhostUrl` → fallback `localhost` → `127.0.0.1`
- **Non-null:** `timeout` — `{ signal, clear } | null`, используется `if/else` (не `?` short-circuit, фикс Batch 5)
- **Инъекция:** `constructor(fetchFn?)` — для тестов передаётся `vi.fn()`

### 9.2 PdfExtractor + PdfRenderer

- `PdfExtractor` — оркестратор: batch по parallelPages, `Math.max(1, step)` guard (фикс Batch 1), `Promise.allSettled` (сбой страницы → `""`, не крах PDF), retry (3 попытки), escalating timeout (90s → 180s → 360s), aggregation
- `PdfPageRenderer` — интерфейс: load, getPageCount, renderToBlob, getPageText, close
- `DefaultPdfRenderer` — pdfjs-dist v4.10.38 (не v6: v6 ломает esbuild ESM→CJS из-за приватных полей `#`)
- **`getPageText(pageNum)`:** 30s timeout → `page.getTextContent()` → `items.map(i => i.str).join(" ")`, фильтр `"str" in item`
- **Render:** `page.render({ canvasContext: ctx, viewport })` (не `{ canvas, viewport }`, это v3+)
- **Worker:** CDN `cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`
- **Canvas:** document.createElement("canvas") (Electron), очистка после toBlob: `canvas.width = 0; canvas.remove()`
- **load:** `getDocument({ data: copy })` where `copy = data.slice()` (независимая копия буфера)

**processPage — fast/vision ветвление:**
- **fast:** `getPageText()` → ≥200 chars → OK. <200 chars → Vision fallback. Ошибка getPageText → Vision fallback.
- **vision:** renderToBlob → blobToBase64 → `ollama.chat()` с `DEFAULT_VISION_PROMPT` и `images: [base64]`
- **Escalating timeout:** 90s (attempt 0), 180s (attempt 1), 360s (attempt 2)

**aggregatePages:** fast + ≤3 страниц → `join("\n\n")` (без LLM). Иначе → `AGGREGATION_PROMPT` + LLM. При ошибке LLM → fallback raw join.

### 9.3 TextExtractor (.txt / .docx)

- **`.txt`:** `TextDecoder().decode(data)` → BOM `\uFEFF` → `""` → `\r\n` → `\n` → `\r` → `\n`. Всегда 1 страница.
- **`.docx`:** `mammoth.convertToMarkdown({ buffer })` (pure JS). При ошибке → `{ markdown: "", pageCount: 0, pages: [] }` (никогда не throw).
- Формат выхода совпадает с `PdfExtractResult` для единообразной обработки.

### 9.4 DocumentStore (прямой режим)

- **Чанкинг:** 1000 символов overlap 200. Скользящее окно: start += 800. Если текст ≤ 1000 → [text].
- **Search:** токенизация query `split(/\s+/).filter(Boolean)` → scoring по количеству совпадений слов в тексте чанка (case-insensitive `.includes()`). Filter score > 0, sort desc, topK.
- **save():** write → .tmp → rename (атомарно).
- **load():** на любой ошибке → `this.chunks = []`.
- **stats:** `{ totalChunks, totalSources }` (source = уникальные sourcePath).

### 9.5 FileWatcher

- `scan(folderPath, extensions?)`:
  1. `loadAndMigrateManifest()` — загружает предыдущие хеши
  2. `scanFiles(folderPath, extensions)` — рекурсивный walk (withFileTypes), фильтр по lowercase extension
  3. Для каждого файла: `try { getFileHash } catch { continue }` — **TOCTOU fix** (фикс Batch 7)
  4. Сравнение с предыдущими хешами: new/changed/unchanged
  5. Deleted: ключи из `previousFiles`, которых нет в `currentKeys` И расширение совпадает с текущим скан-расширением
- **loadAndMigrateManifest():** конвертирует старые относительные ключи в абсолютные (через `path.resolve(nikelDir, "..", key)` + `fs.access`). Если абсолютный путь существует — мигрирует; нет — сохраняет оригинал.
- **Атомарность:** saveManifest → write .tmp → rename

### 9.6 Log Service (FileLogger)

- **Файл:** `{nikelDir}/.nikel/nikel.log`
- **Формат строки:** `[2026-07-03T13:29:00] [INFO]  сообщение  key=val  key=val`
- **Ring buffer:** 500 строк (`this._buffer`), старые строки вытесняются splice
- **Header:** `# Nikel Log / plugin: {version} / maxLines: 500`
- **Debounced writes:**
  - `_pending` — очередь строк на запись
  - `FLUSH_BATCH_SIZE = 20` → немедленный flush
  - `FLUSH_INTERVAL_MS = 200` → debounce timer
  - **Рекурсивный drain:** при конкурентном flush, после ожидания текущего, проверяет `_pending` и рекурсивно доливает (фикс Batch 11)
- **Форсированный flush:** `getLogContent()` / `clear()` → `await this._flushNow()`
- **checkVersion:** читает первую строку файла, парсит версию regex `/plugin:\s*([^\s\/]+)/`. При несовпадении или ошибке → `clear(version)`.
- **Нетранзакционность:** `nikel.log` — append-only + debounce. Потери строк при сбое допустимы.

### 9.7 processWithGraph (@nikel_s)

1. `queryEngine.answerQuestion(question)`:
   - LLM → JSON-массив имён (Array.isArray guard)
   - `graph.search(name)` (substring match)
   - `buildContext()` → `[[link|name]]` + relations
   - LLM с `{contextMd}` и `{question}`
2. `mdGenerator.generateAnswerDoc()` → .md ответа
3. Создаёт `_answers/` если не существует
4. `vault.create(vaultRelPath, content)`:
   - **Если create падает** (лог WARN + try modify) — попытка `vault.modify` (фикс Batch 4)
   - Если modify тоже не удался → `answerFile = null`
5. `editor.replaceRange()`: если answerFile — `[[ссылку]]`; иначе — inline контекст + ответ в формате `> blockquote`
6. `Math.min(triggerLine + 1, editor.lineCount())` — защита выхода за границы

### 9.8 Режимы работы

- **Без графа** (ни одна папка не указана или граф пуст): `processDirect()` — LLM через `@nikel_*`
- **Direct mode** (indexingMode === "direct" + есть папки): `processWithDirectSearch()` — `documentStore.search()` + `ollama.chat()` с контекстом
- **Graph mode** (есть папки + entities.length > 0): `processWithGraph()` — QueryEngine + ответ с контекстом
- **@nikel_f** — всегда `processDirect()` (исправление форматирования, без контекста)

### 9.9 Режим индексации (indexingMode)

| Режим | PDF | TXT/DOCX | LLM | Хранилище |
|-------|-----|----------|-----|-----------|
| `"vision"` | PNG (200 DPI) → Vision LLM → Markdown | TextExtractor | EntityExtractor | KnowledgeGraph |
| `"fast"` | `getPageText()` < 200 chars → Vision fallback | TextExtractor | EntityExtractor | KnowledgeGraph |
| `"direct"` | `getPageText()` (fast mode, без Vision) | TextExtractor | Без LLM | DocumentStore |

- **"vision"** (по умолчанию): ~5-15 сек/страница, работает для любых PDF (текст, сканы, схемы)
- **"fast":** миллисекунды для текстовых PDF, Vision fallback для сканов/схем/таблиц
- **"direct":** секунды, подходит когда не нужен граф знаний (RAG без эмбеддингов)

### 9.10 runIndexing — guard и try/finally

```typescript
async runIndexing(): Promise<void> {
  if (this.isIndexing) { new Notice("Уже запущена"); return }  // guard
  this.isIndexing = true
  this.onIndexingChange?.(true)
  try {
    await this._doIndexing()
  } finally {
    this.isIndexing = false                          // всегда сбрасываем
    this.onIndexingChange?.(false)                   // разблокировка кнопки
  }
}
```

- `isIndexing: boolean` — публичное свойство, контролирует disabled-кнопку «Старт»
- `onIndexingChange: ((running: boolean) => void) | null` — callback для UI

### 9.11 v0.1.0 — vaultBasePath

```typescript
private get vaultBasePath(): string {
  const adapter = this.app.vault.adapter
  if ("basePath" in adapter) {
    return (adapter as { basePath: string }).basePath
  }
  return ""
}
```

- Type guard `"basePath" in adapter` (без `as any`)
- `""` в Obsidian Mobile или remote vaults без basePath
- Используется в `initKnowledgeGraphServices()` и `_doIndexing()`

### 9.12 Обработка удалённых файлов

- **graph mode:** `graph.removeBySource(filePath)` удаляет entity + relations (фикс Batch 5)
- **direct mode:** `documentStore.removeBySource(filePath)` удаляет чанки
- **hash manifest:** `fileWatcher.removeFileHashes(allDeleted, manifest)` чистит хеши
- Deleted files детектятся по отсутствию в `currentKeys` + совпадение extension (чтобы .txt скан не удалял хеши .pdf)

### 9.13 hashFiles fallback

```typescript
const hashFiles = successfullyProcessed.length > 0 ? successfullyProcessed : processedFiles
```

Если ни один файл не обработался успешно — хеши всё равно обновляются (для processedFiles). Это предотвращает повторную индексацию тех же файлов при перезапуске.

### 9.14 exportLog

- `logger.getLogContent()` → frontmatter (type: log-export, created, plugin, lines)
- `vault.create()` / `vault.modify()` (Obsidian API)
- **Fallback:** при ошибке vault → `fs.writeFile(exportPath)` с WARN логом (фикс Batch 3)

### 9.15 CanvasGenerator — layout constants

| Константа | Значение |
|-----------|----------|
| `NODE_WIDTH` | 300 |
| `NODE_HEIGHT` | 150 |
| `START_X` | 100 |
| `START_Y` | 100 |
| `GAP_X` | 400 |
| `GAP_Y` | 250 |
| `MAX_NODES_OVERVIEW` | 50 |

### 9.16 Pdfjs v4 vs v6

- v6 → приватные поля `#` → esbuild ломает ESM→CJS → `_privateGet ... getOrinsertComputed`
- v6 → нет `doc.destroy()` (только `doc.loadingTask.destroy()`)
- v4 → стабильный bundle, `doc.destroy()` работает

## 10. Важно помнить

- `src/settings.ts` удалён — все настройки в `types.ts` и `settings/settings-tab.ts`
- `src/ollama.ts` удалён — клиент в `services/ollama.ts`
- `NikelPlugin.settings` инициализируется в `loadSettings()` — обязательно вызывать перед использованием
- `NikelPlugin.ollama` инициализируется в `onload()` — не использовать в конструкторе
- Circular dependency: `settings-tab.ts` импортирует `NikelPlugin` (type-only через `import type`)
- Все сервисы в `ingestion/`, `graph/`, `generation/` — zero Obsidian dependency
- `pdfjs-dist` + `mammoth` — внешние зависимости, бандлятся в main.js (pure JS, не native)
- `index.json` — транзакционная запись: write → .tmp → rename. Всегда.
- `file-hashes.json` — та же схема атомарности
- `nikel.log` — НЕ транзакционный (append-only + debounce). Потери строк допустимы.
- `document-store.json` — транзакционная запись
- Сгенерированные `.md` в `nikel/` не удалять при переиндексации
- `_answers/` создаётся автоматически при первом сохранении ответа
- `vaultBasePath` — через `"basePath" in adapter` type guard
- `detectSourceType()` — по имени подпапки, после `entityExtractor.extract()`, перед `graph.mergeIndex()`
- `mergeIndex` и `dedupEntities`: aliases (Set merge), properties (last wins), tags (concat), остальное (new ?? existing)
- `searchFiltered` — без non-null `!`
- `165 тестов` (18 файлов), `tsc --noEmit` чисто, build ~1.9MB
- `runIndexing()` — wrapper (guard + try/finally), логика в `_doIndexing()`
- `PdfExtractor` — `Promise.allSettled` для batch: ошибка → `""` без краха
- `successfullyProcessed` — хеши только для успешных; fallback на processedFiles если ни один не успешен
- `fileToFolder` map — привязка файла к его корневой папке для `relPath` → `detectSourceType()`
- `exportLog()` — vault API с fs fallback
- `checkVersion()` — парсит версию из первой строки лога, очищает при обновлении
- `NikelPlugin.isIndexing` + `onIndexingChange` — disabled-состояние кнопки «Старт»

## 11. Результаты аудита (Batch 5)

### Исправлено

| # | Баг | Файл | Что было | Что стало |
|---|-----|------|----------|-----------|
| 1 | Infinite loop | `pdf-extractor.ts:55` | `parallelPages=0` → бесконечный цикл | `Math.max(1, step)` |
| 2 | Empty catch (data loss) | `main.ts:324` | `vault.create` ошибки съедены | Логирование ошибки |
| 3 | Empty catch (silent fallback) | `main.ts:432` | Vault write fail → fs fallback без лога | WARN перед fallback |
| 4 | Greedy catch (file exists) | `main.ts:464` | Любой create fail → modify (даже не "exists") | WARN + modify |
| 5 | KG data leak | `main.ts:208+303` | Удалённые файлы не чистили граф | `graph.removeBySource()` |
| 6 | Unsafe JSON parse | `query-engine.ts:87` | `JSON.parse(…) as string[]` — runtime невалидно | `Array.isArray` guard |
| 7 | TOCTOU crash | `file-watcher.ts:27` | Файл удалён между scan и hash → крах | try/catch + continue |
| 8 | Non-string properties | `entity-extractor.ts:133` | LLM может вернуть числа/boolean | `String(v ?? "")` |
| 9 | Empty relations | `entity-extractor.ts:153` | from/to="" — мусорные связи | `if (!from || !to) return []` |
| 10 | Fragile non-null | `ollama.ts:21` | `timeout!` зависит от `??` short-circuit | `if/else` без `!` |
| 11 | Flush leak | `log-service.ts:108` | Новые строки в `_pending` не доливались | Рекурсивный flush |
| 12 | Error casts | `main.ts:287+371+498+550+587`, `settings-tab.ts:122+137` | `(e as Error).message` — крах на не-Error | `toErrorMessage(e)` |

### Новый хелпер
- `utils.ts` — `toErrorMessage(e: unknown): string` — безопасное извлечение сообщения из `unknown`
- Используется во всех catch в main.ts и settings-tab.ts

### KnowledgeGraph.removeBySource(sourcePath)
Новый метод: удаляет все entity с `source === sourcePath` и их relations. Используется в `_doIndexing()` для очистки графа при удалении файлов.
