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
  │   │   ├── pdf-extractor.ts     — PDF → PNG → Ollama Vision → Markdown
  │   │   ├── pdf-renderer.ts      — DefaultPdfRenderer (pdfjs-dist → PNG)
  │   │   ├── entity-extractor.ts  — Markdown → сущности + связи JSON
  │   │   └── file-watcher.ts      — хеши файлов (MD5), инкрементальная индексация
  │   ├── graph/
  │   │   ├── knowledge-graph.ts   — граф сущностей, merge, dedup, persistence
  │   │   └── query-engine.ts      — поиск по графу для @nikel_s
  │   ├── generation/
  │   │   ├── md-generator.ts      — сущность → .md (frontmatter, [[links]], #tags, Dataview)
  │   │   ├── canvas-generator.ts  — кластер → .canvas (Obsidian Canvas)
  │   │   └── index-generator.ts   — _index.md, _graph.md (Mermaid)
  │   ├── ollama.ts                — HTTP к Ollama (injectable fetch, timeout, retry, fallback)
  │   ├── trigger-parser.ts        — чистая функция: поиск триггера + сборка промпта
  │   └── response-formatter.ts    — чистая функция: форматирование ответа
  ├── suggester.ts                 — EditorSuggest для автокомплита @nik
  └── settings/settings-tab.ts     — вкладка настроек
```

**Директории на диске** (внутри vault, по умолчанию `nikel/`):
- `nikel/materials/`, `nikel/experiments/`, `nikel/properties/` и т.д. — сгенерированные .md сущностей
- `nikel/_answers/` — ответы @nikel_s (YYYY-MM-DD-HHmmss.md)
- `nikel/canvas/` — .canvas файлы (обзор, хронология, кластеры)
- `nikel/.nikel/file-hashes.json` — хеши PDF (FileWatcher)
- `nikel/index.json` — граф знаний (KnowledgeGraph)

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
- **Всего:** 13 test-файлов, 106 тестов

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
| `pdf-extractor` | `pdf-extractor.test.ts` | 7 |
| `entity-extractor` | `entity-extractor.test.ts` | 9 |
| `file-watcher` | `file-watcher.test.ts` | 5 |
| `knowledge-graph` | `knowledge-graph.test.ts` | 17 |
| `query-engine` | `query-engine.test.ts` | 3 |
| `md-generator` | `md-generator.test.ts` | 6 |
| `canvas-generator` | `canvas-generator.test.ts` | 6 |
| `index-generator` | `index-generator.test.ts` | 5 |
| `settings-tab` | — | UI-компонент, не тестируется |
| `pdf-renderer` | — | требует реального PDF, не тестируется |
| `progress-modal` | — | UI-компонент, не тестируется |

## 4. Процесс сборки

```bash
npm run build     # esbuild → main.js (CommonJS bundle, ~1.1MB с pdfjs-dist)
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

### 5.4 Другая LLM (вместо Ollama)

1. Реализовать интерфейс `OllamaClient` из `types.ts`
2. Подставить в `main.ts` вместо `DefaultOllamaClient`
3. Тесты для старого клиента остаются, для нового — свои

### 5.5 Knowledge Graph

#### 5.5.1 Новый тип сущности

1. Добавить значение в `EntityType` в `types.ts`
2. Добавить тип в `entity-extractor.ts` — prompt для LLM
3. Добавить в `TYPE_DIR_MAP` в `utils.ts` (подпапка для .md)
4. Тип появится в `TYPE_LABELS` (index-generator) и Dataview полях автоматически
5. Тесты новых кейсов

#### 5.5.2 Новый тип связи

1. Добавить значение в `RelationType` в `types.ts`
2. Добавить в `entity-extractor.ts` prompt
3. Добавить в `relFieldMap` в `md-generator.ts` — Dataview-поле для этого типа связи
4. Если связь влияет на layout canvas → canvas-generator.ts

#### 5.5.3 Индексация (runIndexing)

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

- `PdfExtractor` принимает `OllamaClient` + `PdfPageRenderer` (интерфейс) — оба мокаются в тестах
- `EntityExtractor` принимает `OllamaClient` — мокается
- `KnowledgeGraph` принимает путь к `index.json` — для тестов во временную папку
- `QueryEngine` принимает `KnowledgeGraph` + `OllamaClient`
- `MdGenerator` принимает `nikelDir: string`
- `CanvasGenerator` принимает `nikelDir: string` + `vaultRelDir: string`
- `IndexGenerator` принимает `nikelDir: string`
- `FileWatcher` принимает `nikelDir: string` (директория, подпапка `.nikel/` создаётся внутри)

### 6.2 Entity Extraction

- LLM возвращает строгий JSON — валидация схемы через type guard
- **Runtime валидация типов:** `VALID_ENTITY_TYPES` / `VALID_RELATION_TYPES` — Set из допустимых строк
- Если JSON невалидный → повторный запрос к LLM (retry 1 раз)
- Если повторно невалидный → throw Error с сырым ответом LLM (для отладки)
- **Entity с неизвестным типом тихо пропускаются** (flatMap → return [])
- `normalizeName()` — обязательный вызов перед dedup
- `dedupEntities()` — merge по (type + normalizedName)
- При дубликате: объединить aliases (Set), перезаписать properties (последний wins)

### 6.3 Persistence

- Значимая операция записи всегда: write → .tmp → rename (атомарность)
- Загрузка `index.json`: если файла нет → пустой IndexManifest
- **Если JSON повреждён (SyntaxError)** → backup (`index.json.bak`), создать новый манифест
- После успешной записи → удалить .tmp
- Хеши PDF: `nikelDir/.nikel/file-hashes.json` — та же логика атомарности и backup

### 6.4 Query Engine

- Всегда возвращает `QueryResult` — даже если ничего не найдено (empty contextMd)
- **Извлечение имён из вопроса** через `extractEntities()` — LLM → JSON-массив строк
- Поиск по графу через `graph.search()` — substring match по name, aliases, context, tags
- `contextMd` содержит `[[materials/Сплав-X.md|Сплав-X]]` (file path + display name), не голые имена
- `linkedDocs` — массив vault-относительных путей для use in `[[links]]`
- Если entity не найдены → LLM с контекстом `"В графе нет информации по вашему вопросу"`
- Ответ LLM должен содержать `[[source links]]`

### 6.5 MD Generation

- Имя файла: `{safeFileName(name)}.md` (safeFileName удаляет `/\:*?"<>|` и лишние пробелы)
- Каждый `.md` содержит Dataview-совместимые поля в frontmatter:
  - `id:`, `type:`, `name:`, `tags:`, `aliases:`
  - relation-поля: `material::`, `mode::`, `property::` и т.д. (по типу связи)
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
getSubDir(type: string): string  // material → "materials", experiment → "experiments"...
safeFileName(name: string): string  // sanitize для имён файлов
```

- `getSubDir()` — единый источник истины для маппинга EntityType → подпапка
- `safeFileName()` — удаляет `/\:*?"<>|`, схлопывает пробелы, убирает лидирующие/конечные дефисы
- Используется всеми тремя генераторами (md, canvas, index)

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

- `PdfExtractor` — оркестратор: batch по parallelPages, retry (2×), aggregation
- `PdfPageRenderer` — интерфейс, `DefaultPdfRenderer` — реализация через pdfjs-dist v6
- `DefaultPdfRenderer`:
  - Worker загружается с CDN: `cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.worker.min.mjs`
  - Render через `document.createElement("canvas")` (в Electron всегда есть DOM)
  - Canvas очищается после `toBlob`: `canvas.width = 0; canvas.remove()`
  - `getPageCount()` — быстрый, без рендера

### 9.3 runIndexing — полный поток

1. `fileWatcher.scan(pdfFolder)` — рекурсивно ищет `.pdf`, сравнивает MD5 с `file-hashes.json`
2. Если изменений нет → `return`
3. `graph.load()` — читает `nikel/index.json`
4. Для каждого нового/изменённого файла:
   - `pdfExtractor.extractPdf(buffer)` → Vision LLM → Markdown
   - `entityExtractor.extract(md)` → Entity[] + Relation[]
   - `graph.mergeIndex(...)` → dedup + merge
5. `fileWatcher.updateFileHashes()` + `graph.save()`
6. Генерация .md для каждой сущности графа (не перезаписывает существующие)
7. Генерация `_index.md`, `_graph.md`, `обзор-базы-знаний.canvas`
8. **ProgressModal** — показывает текущий файл и прогресс (i/N)

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

- **Без графа** (pdfFolder не указан или граф пуст): `processDirect()` — просто LLM через `@nikel_s`
- **С графом** (pdfFolder указан + entities.length > 0): `processWithGraph()` — поиск + ответ с контекстом
- **@nikel_f** — всегда `processDirect()` (исправление форматирования)

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
