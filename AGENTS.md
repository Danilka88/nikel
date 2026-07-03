# AGENTS.md — для AI-агентов (opencode / Deepseek V4 Flash)

Этот файл описывает архитектуру, конвенции и правила разработки плагина **Nikel** для Obsidian. Следуй этим инструкциям при внесении изменений, чтобы сохранить качество и согласованность кода.

## 1. Архитектура

**Принцип:** тонкий слой Obsidian (main.ts) + чистые сервисы без зависимостей от Obsidian.

```
main.ts (оркестрация, вызовы Obsidian API)
  ├── utils.ts                     — getSubDir(), safeFileName()
  ├── ui/
  │   └── progress-modal.ts        — ProgressModal (индексация)
  ├── services/
  │   ├── ingestion/
│   │   ├── pdf-extractor.ts     — PDF → PNG/Text → Ollama Vision → Markdown (с ветвлением fast/vision)
│   │   ├── pdf-renderer.ts      — DefaultPdfRenderer (pdfjs-dist → PNG + getTextContent)
│   │   ├── text-extractor.ts    — TextExtractor: .txt (TextDecoder) / .docx (mammoth) → Markdown
│   │   ├── entity-extractor.ts  — Markdown → сущности + связи JSON
│   │   └── file-watcher.ts      — хеши файлов (MD5), инкрементальная индексация
  │   ├── graph/
  │   │   ├── knowledge-graph.ts   — граф сущностей, merge, dedup, persistence
  │   │   └── query-engine.ts      — поиск по графу для @nikel_s
  │   ├── generation/
  │   │   ├── md-generator.ts      — сущность → .md (frontmatter, [[links]], #tags, Dataview)
  │   │   ├── canvas-generator.ts  — кластер → .canvas (Obsidian Canvas)
  │   │   └── index-generator.ts   — _index.md, _graph.md (Mermaid)
  │   ├── log-service.ts           — FileLogger (лог-файл с буфером 500 строк, автоочистка)
  │   ├── ollama.ts                — HTTP к Ollama (injectable fetch, timeout, retry, fallback)
  │   ├── trigger-parser.ts        — чистая функция: поиск триггера + сборка промпта
  │   └── response-formatter.ts    — чистая функция: форматирование ответа
  ├── suggester.ts                 — EditorSuggest для автокомплита @nik
  └── settings/settings-tab.ts     — вкладка настроек
```

**Директории на диске** (внутри vault, по умолчанию `nikel/`):
- `nikel/materials/`, `nikel/experiments/`, `nikel/properties/`, `nikel/modes/`, `nikel/equipment/`, `nikel/teams/`, `nikel/persons/`, `nikel/conclusions/`, `nikel/topics/`, `nikel/publications/`, `nikel/processes/`, `nikel/facilities/` — сгенерированные .md сущностей
- `nikel/_answers/` — ответы @nikel_s (YYYY-MM-DD-HHmmss.md)
- `nikel/canvas/` — .canvas файлы (обзор, хронология, кластеры)
- `nikel/.nikel/file-hashes.json` — хеши всех файлов (FileWatcher, абсолютные пути)
- `nikel/.nikel/nikel.log` — лог действий и ошибок (FileLogger, 500 строк, автоочистка)
- `nikel/_log-export.md` — экспорт лога для отправки AI (создаётся кнопкой в настройках)
- `nikel/index.json` — граф знаний (KnowledgeGraph)
- `Статьи/`, `Доклады/`, `Журналы/`, `Материалы конференций/`, `Обзоры/` и т.д.
- Тип источника детектируется автоматически по имени подпапки через `detectSourceType()`

## 2. Конвенции кода

### 2.1 Общие

- **Язык:** TypeScript, strict mode (`strict: true`, `strictNullChecks: true`)
- **Форматирование:** пробелы, отступ 2, без точек с запятой
- **Именование:**
  - camelCase для функций, переменных, методов
  - PascalCase для типов, интерфейсов, классов
  - kebab-case для файлов
- **Комментарии:** НЕ добавлять комментарии к коду. Код должен быть самодокументируемым.

### 2.2 Импорты

- Сначала импорты из Obsidian (всегда отдельной группой)
- Затем внутренние модули (относительные пути, без `index.ts`)
- Сортировать по алфавиту внутри групп

### 2.3 Типы

- Все публичные интерфейсы — в `src/types.ts`
- Локальные типы — рядом с использованием, не экспортируются
- Не использовать `any`. Если тип неизвестен — `unknown`.
- `OllamaClient` — интерфейс для injectable-архитектуры (позволяет мокать fetch)

### 2.4 Сервисы (чистые функции)

Каждый сервис в `src/services/` должен:
- Иметь **нулевую зависимость от Obsidian API**
- Быть **чистой функцией** (одинаковый вход → одинаковый выход, без side-эффектов)
- Иметь **≥80% покрытие тестами**
- Экспортировать либо функцию, либо класс с injectable-зависимостями

### 2.5 Обработка ошибок

- Ошибки API — `throw Error` с человекочитаемым сообщением
- В `main.ts` ошибки ловятся в `try/catch` и показываются через `new Notice()`
- Пользовательские уведомления — только на русском языке (для команды)
- Сетевые ошибки Ollama — retry 1 раз + fallback localhost→127.0.0.1, timeout 120s
- `isRetryable(err)` ретраит `TypeError` и `DOMException AbortError`
- `enhanceError()` — оборачивает сырые ошибки в русский текст с инструкциями

## 3. Структура тестов

- **Фреймворк:** vitest v4
- **Конфиг:** `vitest.config.ts` — alias `obsidian → tests/__mocks__/obsidian.ts`
- **Расположение:** `tests/services/*.test.ts` (один файл на один сервис)
- **Mock Obsidian:** `tests/__mocks__/obsidian.ts` — заглушки `Plugin`, `MarkdownView`, `Notice`, `Setting`, `Modal`, `EditorSuggest`, `TFile`
- **Mock fetch:** передаётся в `DefaultOllamaClient(mockFetch)` — не использовать глобальный mock
- **Всего:** 15 test-файлов, 127 тестов

### 3.1 Правила тестирования

1. Каждый сервис — отдельный test-файл
2. Каждый test-файл содержит describe-блоки: по одному на экспортируемую функцию/метод
3. Каждый кейс — атомарный `it()` с понятным названием на русском
4. Тесты не должны требовать запущенного Ollama или Obsidian
5. В тестах `main.ts` обязательно мокать `Notice.lastMessage` для проверки уведомлений
6. PdfExtractor тесты мокают `PdfPageRenderer` — не используют реальный pdfjs

### 3.2 Покрытие

| Модуль | Файл тестов | Количество тестов |
|--------|------------|-------------------|
| `trigger-parser` | `trigger-parser.test.ts` | 13 |
| `response-formatter` | `response-formatter.test.ts` | 6 |
| `ollama` | `ollama.test.ts` | 13 |
| `suggester` | `suggester.test.ts` | 9 |
| `main` | `main.test.ts` | 7 |
| `pdf-extractor` | `pdf-extractor.test.ts` | 10 |
| `text-extractor` | `text-extractor.test.ts` | 4 |
| `entity-extractor` | `entity-extractor.test.ts` | 9 |
| `file-watcher` | `file-watcher.test.ts` | 5 |
| `knowledge-graph` | `knowledge-graph.test.ts` | 23 |
| `query-engine` | `query-engine.test.ts` | 3 |
| `md-generator` | `md-generator.test.ts` | 8 |
| `canvas-generator` | `canvas-generator.test.ts` | 6 |
| `index-generator` | `index-generator.test.ts` | 5 |
| `log-service` | `log-service.test.ts` | 7 |
| `utils` | `utils.test.ts` | 10 |
| `settings-tab` | — | UI-компонент, не тестируется |
| `pdf-renderer` | — | требует реального PDF, не тестируется |
| `pdf-renderer (integration)` | `tests/integration/pdf-renderer.test.ts` | 4 — mocked pdfjs + canvas, тестирует getPageText, load→render→close |
| `progress-modal` | — | UI-компонент, не тестируется |

## 4. Процесс сборки

```bash
npm run build     # esbuild → main.js (CommonJS bundle, ~1.1MB с pdfjs-dist v4.10.38)
npm run test      # vitest run
npx tsc --noEmit  # type check
npm run dev       # esbuild в режиме watch
```

- `main.js` — единственный выходной файл, коммитится в репозиторий
- `esbuild.config.mjs` использует `external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "builtinModules"]` — Obsidian API и Node builtins не бандлятся
- `pdfjs-dist` — НЕ в external, бандлится в main.js
- Перед добавлением нового npm-пакета: проверить, что это pure JS (не native). Native модули не работают в Obsidian плагинах.
- При изменении `tsconfig.json` убедись, что `include` покрывает `src/` и `tests/`

## 5. Расширение функционала

### 5.1 Новая команда

1. Добавить запись в `DEFAULT_SETTINGS.commands` в `types.ts`
2. Тесты `trigger-parser.test.ts` и `suggester.test.ts` уже покрывают generic-кейсы — новые тесты не обязательны, если логика не меняется

### 5.2 Новый сервис

1. Создать файл в `src/services/`
2. Экспортировать чистую функцию или класс с injectable-зависимостями
3. Написать тесты в `tests/services/`
4. Использовать в `main.ts`
5. Добавить инициализацию в `initKnowledgeGraphServices()`

### 5.3 Новая настройка

1. Добавить поле в `NikelSettings` в `types.ts`
2. Добавить UI-элемент в `NikelSettingTab.display()`
3. Использовать в `main.ts` через `this.settings`
4. Если настройка влияет на сервисы — передать её в конструктор или через init (см. `indexingMode` → `PdfExtractorOptions`)

### 5.4 Другая LLM (вместо Ollama)

1. Реализовать интерфейс `OllamaClient` из `types.ts`
2. Подставить в `main.ts` вместо `DefaultOllamaClient`
3. Тесты для старого клиента остаются, для нового — свои

### 5.5 Knowledge Graph

#### 5.5.1 Текущая онтология

**12 типов сущностей:** material, experiment, property, mode, equipment, team, person, conclusion, topic, publication, process, facility

**13 типов связей:** uses_material, has_property, in_mode, uses_equipment, conducted_by, leads_to, related_to, precedes, described_in, operates_at_condition, produces_output, validated_by, contradicts

**Метаданные Entity:** confidence (high/medium/low), geography (ru/foreign/both), year, sourceType (article/report/patent/conference/review/dissertation/other)

#### 5.5.2 Новый тип сущности

1. Добавить значение в `EntityType` в `types.ts`
2. Добавить тип в `entity-extractor.ts` — prompt для LLM
3. Добавить в `TYPE_DIR_MAP` в `utils.ts` (подпапка для .md)
4. Тип появится в `TYPE_LABELS` (index-generator) и Dataview полях автоматически
5. Тесты новых кейсов

#### 5.5.3 Новый тип связи

1. Добавить значение в `RelationType` в `types.ts`
2. Добавить в `entity-extractor.ts` prompt
3. Добавить в `relFieldMap` в `md-generator.ts` — Dataview-поле для этого типа связи
4. Если связь влияет на layout canvas → canvas-generator.ts

#### 5.5.4 Индексация (runIndexing)

```
scan PDF folder → fileWatcher.scan() → сравнивает MD5 хеши
  ↓
load graph → graph.load() → читает nikel/index.json
  ↓ для каждого нового/изменённого PDF:
    pdf-extractor.extractPdf(buffer) → PDF → PNG → Vision LLM → Markdown
    entity-extractor.extract(md) → Markdown → LLM → Entity[] + Relation[]
    graph.mergeIndex(...) → dedup + merge в память
  ↓
fileWatcher.updateFileHashes() → .nikel/file-hashes.json
graph.save() → index.json (write → .tmp → rename)
  ↓
generate .md для каждой сущности (не перезаписывает существующие)
generate _index.md, _graph.md
generate обзор-базы-знаний.canvas
  ↓
ProgressModal с <progress> и названием текущего файла
```

Правила:
- Всегда инкрементальная (по MD5 хешам)
- Всегда транзакционная (write → .tmp → rename)
- Никогда не удалять пользовательские документы в `nikel/` при переиндексации
- Если LLM вернула некорректный JSON — пропустить файл, ошибка логируется в консоль
- При повреждении `index.json` → создаётся `index.json.bak`

## 6. Knowledge Graph System — правила

### 6.1 Injection

- `PdfExtractor` принимает `OllamaClient` + `PdfPageRenderer` + `Logger?` (опционально) — все мокаются в тестах
- `EntityExtractor` принимает `OllamaClient` — мокается
- `KnowledgeGraph` принимает путь к `index.json` — для тестов во временную папку
- `QueryEngine` принимает `KnowledgeGraph` + `OllamaClient`
- `MdGenerator` принимает `nikelDir: string`
- `CanvasGenerator` принимает `nikelDir: string` + `vaultRelDir: string`
- `IndexGenerator` принимает `nikelDir: string`
- `FileWatcher` принимает `nikelDir: string` (директория, подпапка `.nikel/` создаётся внутри)

### 6.2 Entity Extraction

- LLM возвращает строгий JSON — валидация схемы через type guard
- **Runtime валидация типов:** `VALID_ENTITY_TYPES` (12 типов) / `VALID_RELATION_TYPES` (13 типов) — Set из допустимых строк
- Если JSON невалидный → повторный запрос к LLM (retry 1 раз)
- Если повторно невалидный → throw Error с сырым ответом LLM (для отладки)
- **Entity с неизвестным типом тихо пропускаются** (flatMap → return [])
- `normalizeName()` — обязательный вызов перед dedup
- `dedupEntities()` — merge по (type + normalizedName)
- При дубликате: объединить aliases (Set), перезаписать properties (последний wins), сохранить confidence/geography/year/sourceType (новый ?? существующий)
- Новые optional-поля Entity:
  - `confidence?: "high" | "medium" | "low"` — уровень достоверности
  - `geography?: "ru" | "foreign" | "both"` — географическая принадлежность
  - `year?: number` — год публикации
  - `sourceType?: "article" | "report" | "patent" | "conference" | "review" | "dissertation" | "other"` — тип источника

### 6.3 Persistence

- Значимая операция записи всегда: write → .tmp → rename (атомарность)
- Загрузка `index.json`: если файла нет → пустой IndexManifest
- **Если JSON повреждён (SyntaxError)** → backup (`index.json.bak`), создать новый манифест
- После успешной записи → удалить .tmp
- Хеши PDF: `nikelDir/.nikel/file-hashes.json` — та же логика атомарности и backup

### 6.4 Query Engine

- Всегда возвращает `QueryResult` — даже если ничего не найдено (empty contextMd)
- **Извлечение имён из вопроса** через `extractEntities()` — LLM → JSON-массив строк
- Поиск по графу через `graph.search()` (text) или `graph.searchFiltered(filters)` (текст + тип + география + год + confidence + числовые диапазоны)
- `contextMd` содержит `[[materials/Сплав-X.md|Сплав-X]]` (file path + display name), не голые имена
- `linkedDocs` — массив vault-относительных путей для use in `[[links]]`
- Если entity не найдены → LLM с контекстом `"В графе нет информации по вашему вопросу"`
- Ответ LLM должен содержать `[[source links]]`
- `answerQuestion(question, filters?)` — опциональный параметр `SearchFilters`:
  - `types: EntityType[]` — фильтр по типу сущности
  - `geography: "ru" | "foreign" | "both"` — география
  - `yearMin / yearMax` — диапазон лет
  - `confidence: "high" | "medium" | "low"`
  - `tags: string[]`
  - `numericParams: [{ name, operator ("lt"|"lte"|"gt"|"gte"|"eq"), value, unit? }]`

### 6.5 MD Generation

- Имя файла: `{safeFileName(name)}.md` (safeFileName удаляет `/\:*?"<>|` и лишние пробелы)
- Каждый `.md` содержит Dataview-совместимые поля в frontmatter:
  - `id:`, `type:`, `name:`, `tags:`, `aliases:`
  - relation-поля: `material`, `mode`, `property`, `equipment`, `team`, `conclusion`, `related`, `precedes`, `source` (described_in), `condition` (operates_at_condition), `output` (produces_output), `validated` (validated_by), `contradicts`
  - метаданные (если есть): `confidence`, `geography`, `year`, `sourceType`
- Каждый `.md` содержит `[[links]]` на связанные сущности (все типы связей, а не subset)
- `_answers/` — документы-ответы от @nikel_s, создаётся автоматически при первом сохранении
- `_answers/YYYY-MM-DD-HHmmss.md` — формат имени файла ответа
- `generateAnswerDoc()` — полный документ с вопросом, ответом, контекстом и источниками
- `buildFrontmatter()` — ручной YAML-сериализатор (без external-зависимостей)

### 6.6 Canvas Generation

- `.canvas` — JSON Schema Obsidian Canvas 1.0
- Node type всегда `"file"` (ссылка на .md, не на встроенный контент)
- `file:` — vault-относительный путь через `this._vaultRelDir`
- Edge `fromSide`/`toSide` — `"right"`/`"left"` для однонаправленных, `"top"`/`"bottom"` для двунаправленных
- Layout: галечный (force-directed) — простая сетка, без внешних библиотек
- **`generateGlobalOverview()`** — режет entities до 50, relations фильтрует по entityIds (нет свисающих рёбер)
- `MAX_NODES_OVERVIEW = 50` — верхняя граница для overview

## 7. Утилиты (src/utils.ts)

```typescript
getSubDir(type: string): string             // material → "materials", experiment → "experiments"...
safeFileName(name: string): string           // sanitize для имён файлов
detectSourceType(relPath: string): Entity["sourceType"]  // "Статьи/..." → "article"
```

- `getSubDir()` — единый источник истины для маппинга EntityType → подпапка. 12 типов.
- `safeFileName()` — удаляет `/\:*?"<>|`, схлопывает пробелы, убирает лидирующие/конечные дефисы
- `detectSourceType()` — определяет тип источника по имени подпапки в пути. Распознаёт: доклады, журналы, статьи, материалы конференций, обзоры, патенты, диссертации (русские имена). Неизвестное → "other".
- Используются всеми генераторами (md, canvas, index) и main.ts

## 8. UI (src/ui/)

### 8.1 ProgressModal

- `new ProgressModal(app, title)` — модальное окно с `<progress>` и текстовой меткой
- `setProgress(current, total, label?)` — обновляет прогресс и подпись
- Автоматически закрывается по `modal.close()`
- Используется в `runIndexing()` для отображения прогресса по файлам

## 9. Важные детали реализации

### 9.1 OllamaClient

- `generate(opts)` — `/api/generate` (старый API, prompt-based)
- `chat(opts)` — `/api/chat` (новый API, messages-based, поддерживает `images[]` для Vision)
- `listModels(url)` — `/api/tags`
- **Таймаут:** по умолчанию 120s через `timeoutSignal()` (AbortController + setTimeout)
- **Очистка таймера:** `finally { timeout?.clear() }` — предотвращает утечку handle
- **Retry:** 1 попытка при TypeError (сеть упала) или AbortError (таймаут)
- **Fallback:** `localhost` → `127.0.0.1` при сетевой ошибке на localhost (разные резолверы)
- **Инъекция:** `constructor(fetchFn?)` — для тестов передаётся `vi.fn()`

### 9.2 PdfExtractor + PdfRenderer

- `PdfExtractor` — оркестратор: batch по parallelPages, retry (2×), aggregation, ветвление по indexingMode
- `PdfPageRenderer` — интерфейс с методами `load`, `getPageCount`, `renderToBlob`, `getPageText`, `close`
- `DefaultPdfRenderer` — реализация через `pdfjs-dist v4.10.38`
- **`getPageText(pageNum)`:** вызывает `page.getTextContent()` → `items.map(i => i.str).join(" ")`. Используется в fast-режиме для извлечения текста без рендера PNG.
- **Архитектура загрузки:** PDF загружается **один раз** (`load(data)`), все страницы рендерятся из одного документа. Нет race-condition между параллельными render-вызовами. После обработки — `close()` вызывает `doc.destroy()`.
- **Буфер:** `main.ts` читает файл через `fs.readFile()` → `Uint8Array.from(raw)` (независимая копия). `PdfPageRenderer.load()` принимает `Uint8Array`, передаёт в pdfjs через `getDocument({ data: copy })` где `copy = data.slice()`.
- **Render-параметр:** `page.render({ canvasContext: ctx, viewport })` — передаётся 2D-контекст, а не DOM-элемент canvas. В pdfjs v3+ параметр `canvas` не работает.
- **Worker** загружается с CDN: `cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`
- **Почему v4, а не v6:**
  - v6 использует приватные поля (`#`), которые esbuild ломает при конвертации ESM→CJS → ошибка `_privateGet ... getOrinsertComputed`
  - v6 не имеет `doc.destroy()` → только `doc.loadingTask.destroy()` (менее стабильный API)
  - v4 стабильно бандлится с esbuild, `doc.destroy()` работает
  - v4 API: `page.render({ canvasContext: ctx, viewport })` (не путать с `{ canvas, viewport }`)
- Render через `document.createElement("canvas")` (в Electron всегда есть DOM)
- Canvas очищается после `toBlob`: `canvas.width = 0; canvas.remove()`
- `getPageCount()` — быстрый, без рендера (читает `doc.numPages`)

### 9.3 runIndexing — полный поток

1. `logger.clear(version)` — сброс лога перед новой индексацией
2. `fileWatcher.scan(pdfFolder)` — рекурсивно ищет `.pdf` (только `.pdf`, `.docx` и другие игнорируются), сравнивает MD5 с `file-hashes.json`
3. Если изменений нет → `return`
4. `graph.load()` — читает `nikel/index.json`
5. Для каждого нового/изменённого файла:
   - `fs.readFile(filePath)` → `Uint8Array.from(raw)` (копия, не pool) → `pdfExtractor.extractPdf(data)`
     - **fast mode:** `getPageText()` → если ≥200 символов, сразу возвращает текст; Vision fallback для сканов
     - **vision mode:** каждая страница → PNG (200 DPI) → Ollama Vision → Markdown
     - Агрегация: fast + ≤3 страниц → простая склейка, иначе LLM-агрегация
   - `entityExtractor.extract(md)` → Entity[] + Relation[]
   - `detectSourceType(relPath)` → sourceType (из подпапки: Статьи → article и т.д.)
   - `entity.sourceType = sourceType` — проставляется на каждой сущности
   - `graph.mergeIndex(...)` → dedup + merge (вкл. confidence/geography/year/sourceType)
6. `fileWatcher.updateFileHashes()` + `graph.save()`
7. Генерация .md для каждой сущности графа (не перезаписывает существующие)
8. Генерация `_index.md`, `_graph.md`, `обзор-базы-знаний.canvas`
9. **ProgressModal** — показывает текущий файл и прогресс (i/N)

### 9.4 processWithGraph (@nikel_s)

1. `queryEngine.answerQuestion(question)`:
   - LLM извлекает имена сущностей из вопроса
   - `graph.search(name)` по каждому имени (substring match)
   - `buildContext()` — контекст в формате Obsidian [[links]]
   - LLM генерирует ответ с использованием контекста
2. `mdGenerator.generateAnswerDoc()` — создаёт .md ответа с frontmatter
3. Создаёт `_answers/` если не существует
4. `vault.create(path, content)` — сохраняет в Obsidian vault
5. `editor.replaceRange()` — вставляет `[[ссылку]]` на ответ или контекст если файл не создался
6. `Math.min(triggerLine + 1, editor.lineCount())` — защита от выхода за границы

### 9.5 Режимы работы

- **Без графа** (ни одна папка источников не указана или граф пуст): `processDirect()` — просто LLM через `@nikel_s`
- **С графом** (хотя бы одна папка источников указана + entities.length > 0): `processWithGraph()` — поиск + ответ с контекстом
- **@nikel_f** — всегда `processDirect()` (исправление форматирования)

### 9.6 Режим индексации (indexingMode)

Настройка `indexingMode` в `NikelSettings` (dropdown в настройках, значения: `"vision" | "fast"`):

- **`"vision"` (по умолчанию):** каждая страница PDF → PNG (200 DPI) → Ollama Vision LLM → Markdown. Медленно (~5-15 сек/страница), но работает для любых PDF (текст, сканы, схемы).
- **`"fast"`:** каждая страница → `page.getTextContent()` (миллисекунды). **Vision fallback** только если текст страницы < 200 символов (скан/схема/таблица). При fallback DPI снижается до 100.
- **Агрегация:** в fast-режиме для PDF ≤3 страниц LLM-агрегация пропускается (простая склейка страниц `\n\n`).

### 9.7 Система логирования (FileLogger)

**Интерфейс `Logger`** (в `types.ts`):
```typescript
interface Logger {
  info(msg, context?): Promise<void>
  warn(msg, context?): Promise<void>
  error(msg, context?): Promise<void>
  clear(pluginVersion?): Promise<void>
  getLogContent(): Promise<string>
}
```

**Реализация `FileLogger`** (в `services/log-service.ts`):
- **Файл:** `{nikelDir}/.nikel/nikel.log`
- **Формат строки:** `[2026-07-03T13:29:00] [INFO]  сообщение  key=val  key=val`
- **In-memory ring buffer:** 500 строк (старые строки вытесняются)
- **Header:** `# Nikel Log / plugin: 0.1.0 / maxLines: 500`
- **Автоочистка при старте `runIndexing()`:** `logger.clear(version)`
- **Автоочистка при обновлении плагина:** `logger.checkVersion(version)` в `onload()` сравнивает версию из header'а файла с `this.manifest.version`. При несовпадении — очистка.
- **Ручная очистка:** кнопка в настройках → `NikelPlugin.clearLog()`

**Где логируется:**
| Место | Уровень | Что пишется |
|-------|---------|-------------|
| `PdfExtractor.processPage()` fast | INFO | `Page N: fast mode, extracted X chars` |
| `PdfExtractor.processPage()` fast fallback | WARN | `Page N: fast mode X chars < 200 → Vision fallback` |
| `PdfExtractor.processPage()` vision retry | WARN | `Page N: attempt 1/3 failed: timeout` |
| `PdfExtractor.aggregatePages()` skip | INFO | `Skipping LLM aggregation: fast mode, 3 pages` |
| `main.ts runIndexing()` | INFO | `Starting PDF indexing`, `Processing: file.pdf`, `Indexing complete` |
| `main.ts runIndexing()` catch | ERROR | `Indexing failed: ...` |
| `main.ts processWithGraph()` | INFO | `processWithGraph` + input snippet |
| `main.ts processDirect()` | INFO | `processDirect` + trigger name |
| Все catch блоки main.ts | ERROR | Текст ошибки |

**Экспорт лога для AI:**
Кнопка в настройках «📋 Создать отчёт» → вызывает `NikelPlugin.exportLog()` → создаёт заметку `nikel/_log-export.md` с frontmatter (type, created, plugin, lines) и содержимым лога в code block.

## 10. Важно помнить

- `src/settings.ts` удалён — все настройки в `types.ts` и `settings/settings-tab.ts`
- `src/ollama.ts` удалён — клиент в `services/ollama.ts`
- `NikelPlugin.settings` инициализируется в `loadSettings()` — обязательно вызывать перед использованием
- `NikelPlugin.ollama` инициализируется в `onload()` — не использовать в конструкторе
- Circular dependency: `settings-tab.ts` импортирует `NikelPlugin` (type-only через `import type`), это единственное исключение
- Все сервисы в `ingestion/`, `graph/`, `generation/` — zero Obsidian dependency
- `pdfjs-dist` — единственная внешняя зависимость, бандлится в main.js через esbuild
- `index.json` — транзакционная запись: write → .tmp → rename. Всегда.
- `file-hashes.json` — та же схема атомарности
- `nikel/index.json` и `nikel/.nikel/file-hashes.json` — независимые файлы
- Сгенерированные `.md` в `nikel/` не удалять при переиндексации — только обновлять существующие и создавать новые
- `_answers/` создаётся автоматически при первом сохранении ответа
- `vaultBasePath` — через `"basePath" in adapter` type guard (без `as any`)
- `detectSourceType()` определяет тип источника по имени подпапки относительно `pdfFolder`. В `main.ts` sourceType проставляется после entityExtractor.extract(), перед graph.mergeIndex()
- `mergeIndex` и `dedupEntities` мерджят: aliases, properties, tags, sourcePage, context, confidence, geography, year, sourceType. Принцип: новое значение ?? существующее.
- `searchFiltered` НЕ использует non-null `!` — все опциональные поля вынесены в локальные переменные до filter()
- `import("fs/promises")` — только статический импорт, не в цикле
### 9.8 TextExtractor (.txt / .docx)

**Файл:** `src/services/ingestion/text-extractor.ts`
**Зависимость:** `mammoth` (pure JS, .docx → Markdown)

Интерфейс выхода совпадает с `PdfExtractResult` (`{ markdown, pageCount, pages }`), что позволяет `runIndexing()` обрабатывать все форматы единообразно.

- **`.txt`:** `new TextDecoder().decode(data)` → `\r\n` → `\n`. Всегда 1 страница.
- **`.docx`:** `mammoth.convertToMarkdown({ buffer })` → Markdown. При ошибке (битые/невалидные файлы) возвращает пустой результат (не бросает исключение).
- Не требует Vision LLM, не использует pdfjs.
- Для TXT и DOCX всегда 1 «страница» (нет постраничной структуры).

**Настройки:** три независимые папки в `NikelSettings`:
- `pdfFolder: string` — рекурсивный поиск `.pdf`
- `txtFolder: string` — рекурсивный поиск `.txt`
- `docxFolder: string` — рекурсивный поиск `.docx`

Все файлы из всех папок индексируются в единый граф. `@nikel_s` ищет по всем сущностям независимо от формата исходного файла.

### 9.9 FileWatcher — множественные расширения и абсолютные пути

**Файл:** `src/services/ingestion/file-watcher.ts`

- `scan(folderPath, extensions?)` — раньше был хардкод `.pdf`, теперь принимает массив расширений (по умолчанию `[".pdf"]`).
- **Абсолютные пути** в качестве ключей `file-hashes.json` — чтобы избежать коллизий между разными корневыми папками.
- **Миграция:** `loadAndMigrateManifest()` при загрузке конвертирует старые относительные ключи в абсолютные (если файл существует по предполагаемому пути).
- Поддерживает параллельное сканирование нескольких папок (по одной за раз).

## 10. Важно помнить

- `142 теста` (17 файлов, включая integration/pdf-renderer.test.ts, log-service.test.ts, text-extractor.test.ts), build prod ~1.9MB (pdfjs-dist v4.10.38 + mammoth), tsc clean
- `indexingMode` — три значения влияют на поведение: `"vision"` (PNG+Vision LLM) / `"fast"` (getTextContent + Vision fallback при <200 символов)
- `FileLogger` — единственный сервис с сайд-эффектами (файловый лог). Не критичен — ошибки записи лога тихо игнорируются.
- `nikel.log` — не транзакционный (append-only), в отличие от `index.json` и `file-hashes.json`. Потери строк при сбое допустимы.
- `exportLog()` использует `vault.create/modify` (Obsidian API) с fallback на `fs.writeFile` — для совместимости с окружением.
- `checkVersion()` — читает первую строку лога, парсит версию плагина. При несовпадении → `clear()`. При отсутствии файла → `clear()`.
