# AGENTS.md — для AI-агентов (opencode / Deepseek V4 Flash)

Этот файл описывает архитектуру, конвенции и правила разработки плагина **Nikel** для Obsidian. Следуй этим инструкциям при внесении изменений, чтобы сохранить качество и согласованность кода.

## 1. Архитектура

**Принцип:** тонкий слой Obsidian (main.ts) + чистые сервисы без зависимостей от Obsidian.

```
main.ts (оркестрация, вызовы Obsidian API)
  ├── services/
  │   ├── ingestion/
  │   │   ├── pdf-extractor.ts     — PDF → PNG → Ollama Vision → Markdown
  │   │   ├── entity-extractor.ts  — Markdown → сущности + связи JSON
  │   │   └── file-watcher.ts      — хеши файлов, инкрементальная индексация
  │   ├── graph/
  │   │   ├── knowledge-graph.ts   — граф сущностей, merge, dedup, persistence
  │   │   └── query-engine.ts      — поиск по графу для @nikel_s
  │   ├── generation/
  │   │   ├── md-generator.ts      — сущность → .md (frontmatter, [[links]], #tags)
  │   │   ├── canvas-generator.ts  — кластер → .canvas (Obsidian Canvas)
  │   │   └── index-generator.ts   — _index.md, _graph.md
  │   ├── ollama.ts                — HTTP к Ollama (injectable fetch)
  │   ├── trigger-parser.ts        — чистая функция: поиск триггера + сборка промпта
  │   └── response-formatter.ts    — чистая функция: форматирование ответа
  ├── suggester.ts                 — EditorSuggest для автокомплита @nik
  └── settings/settings-tab.ts     — вкладка настроек
```

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
- Иметь **100% покрытие тестами**
- Экспортировать либо функцию, либо класс с injectable-зависимостями

### 2.5 Обработка ошибок

- Ошибки API — `throw Error` с человекочитаемым сообщением
- В `main.ts` ошибки ловятся в `try/catch` и показываются через `new Notice()`
- Пользовательские уведомления — только на русском языке (для команды)
- Сетевые ошибки Ollama — retry 1 раз, timeout 120s

## 3. Структура тестов

- **Фреймворк:** vitest v4
- **Расположение:** `tests/services/*.test.ts` (один файл на один сервис)
- **Mock Obsidian:** `tests/__mocks__/obsidian.ts` — заглушки `Plugin`, `Notice`, `EditorSuggest` и т.д.
- **Mock fetch:** передаётся в `DefaultOllamaClient(mockFetch)` — не использовать глобальный mock

### 3.1 Правила тестирования

1. Каждый сервис — отдельный test-файл
2. Каждый test-файл содержит describe-блоки: по одному на экспортируемую функцию/метод
3. Каждый кейс — атомарный `it()` с понятным названием на русском
4. Тесты не должны требовать запущенного Ollama или Obsidian
5. В тестах `main.ts` обязательно мокать `Notice.lastMessage` для проверки уведомлений

### 3.2 Покрытие

| Модуль | Минимальное покрытие | Ключевые кейсы |
|--------|---------------------|----------------|
| `trigger-parser` | 100% | Триггер найден/не найден, несколько команд, disabled, пустой input, сканирование вверх |
| `response-formatter` | 100% | Пустой/однострочный/многострочный ответ, модель в заголовке |
| `ollama` | 90%+ | Успех, HTTP-ошибка, TypeError (retry), пустой список моделей, URL normalisation |
| `suggester` | 90%+ | Regex match/no match, фильтрация по query, enabled/disabled |
| `main` | 80%+ | Весь flow, пустой редактор, пустой ответ, ошибка API |
| `pdf-extractor` | 80%+ | Рендер страницы, Vision вызов, агрегация, пустой PDF, ошибка pdfjs |
| `entity-extractor` | 90%+ | Извлечение из markdown, normalizeName, dedup, дубликаты, пустой документ |
| `file-watcher` | 80%+ | Новые/изменённые/удалённые файлы, пустая папка, кривой JSON |
| `knowledge-graph` | 90%+ | CRUD, merge, dedup, BFS cluster, persist, поиск по aliases |
| `query-engine` | 80%+ | Извлечение сущностей из вопроса, пустой результат, несколько сущностей |
| `md-generator` | 90%+ | Frontmatter, [[links]], #tags, Dataview, пустые поля, стилизация |
| `canvas-generator` | 80%+ | Cluster, overview, timeline, пустой граф |
| `index-generator` | 80%+ | _index.md, Mermaid diagram |
| `settings-tab` | — | UI-компонент, не тестируется |

## 4. Процесс сборки

```bash
npm run build     # esbuild → main.js (CommonJS bundle)
npm run test      # vitest run
npx tsc --noEmit  # type check
```

- `main.js` — единственный выходной файл, коммитится в репозиторий
- `esbuild.config.mjs` использует `external: ["obsidian", ...]` — Obsidian API не бандлится
- При изменении `tsconfig.json` убедись, что `include` покрывает `src/` и `tests/`

## 5. Расширение функционала

### 5.1 Новая команда

1. Добавить запись в `DEFAULT_SETTINGS.commands` в `types.ts`
2. Тесты `trigger-parser.test.ts` и `suggester.test.ts` уже покрывают generic-кейсы — новые тесты не обязательны, если логика не меняется

### 5.2 Новый сервис

1. Создать файл в `src/services/`
2. Экспортировать чистую функцию или класс
3. Написать тесты в `tests/services/`
4. Использовать в `main.ts`

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
3. Добавить подпапку в `md-generator.ts` — путь генерации
4. Добавить тип в `knowledge-graph.ts` — если нужна особая логика merge
5. Тесты новых кейсов

#### 5.5.2 Новый тип связи

1. Добавить значение в `RelationType` в `types.ts`
2. Добавить в entity-extractor prompt
3. Если связь влияет на layout canvas → canvas-generator.ts

#### 5.5.3 Индексация

- Всегда инкрементальная (по MD5 хешам)
- Всегда транзакционная (write → .tmp → rename)
- Никогда не удалять пользовательские документы в nikel/ при переиндексации
- Если LLM вернула некорректный JSON — пропустить файл, записать ошибку в лог

## 6. Knowledge Graph System — правила

### 6.1 Injection

- `PdfExtractor` принимает `OllamaClient` и `typeof pdfjsLib` — оба мокаются в тестах
- `EntityExtractor` принимает `OllamaClient` — мокается
- `KnowledgeGraph` принимает путь к index.json — для тестов во временную папку
- `QueryEngine` принимает `KnowledgeGraph` + `OllamaClient`
- Все генераторы принимают `nikelDir: string`
- `FileWatcher` принимает `nikelDir: string`

### 6.2 Entity Extraction

- LLM возвращает строгий JSON — валидация схемы через type guard
- Если JSON невалидный → повторный запрос к LLM (retry 1 раз)
- Если повторно невалидный → throw Error с сырым ответом LLM (для отладки)
- `normalizeName()` — обязательный вызов перед dedup
- `dedupEntities()` — merge по (type + normalizedName)
- При дубликате: объединить aliases (Set), перезаписать properties (последний wins)

### 6.3 Persistence

- Значимая операция записи всегда: write → .tmp → rename (атомарность)
- Загрузка index.json: если файла нет → пустой IndexManifest
- Если JSON повреждён → backup (.nikel/index.json.bak), создать новый
- После успешной записи → удалить .tmp

### 6.4 Query Engine

- Всегда возвращает `QueryResult` — даже если ничего не найдено (empty contextMd)
- Если entity не найдены → LLM с контекстом "В графе нет информации по вашему вопросу"
- `contextMd` формируется в едином формате для всех типов сущностей
- Ответ LLM должен содержать [[source links]]

### 6.5 MD Generation

- Каждый `.md` содержит Dataview-совместимые поля в frontmatter (`property:: value`)
- Каждый `.md` содержит `[[links]]` на связанные сущности
- `_answers/` — документы-ответы от @nikel_s, не перезаписываются при индексации
- Имя файла: `{entity-type-normalized}-{id}.md` для машинной генерации
- Для ручных ответов: `YYYY-MM-DD-HHmmss.md`

### 6.6 Canvas Generation

- `.canvas` — JSON Schema Obsidian Canvas 1.0
- Node type всегда `"file"` (ссылка на .md, не на встроенный контент)
- Edge `fromSide`/`toSide` — `"right"`/`"left"` для однонаправленных, `"top"`/`"bottom"` для двунаправленных
- Layout: галечный (force-directed) — простая сетка, без внешних библиотек

## 8. Важно помнить

- `src/settings.ts` удалён — все настройки в `types.ts` и `settings/settings-tab.ts`
- `src/ollama.ts` удалён — клиент в `services/ollama.ts`
- `NikelPlugin.settings` инициализируется в `loadSettings()` — обязательно вызывать перед использованием
- `NikelPlugin.ollama` инициализируется в `onload()` — не использовать в конструкторе
- Circular dependency: `settings-tab.ts` импортирует `NikelPlugin` (type-only через `import type`), это единственное исключение
- `KnowledgeGraph`, `QueryEngine`, `PdfExtractor`, `EntityExtractor`, `FileWatcher` — инициализируются в `onload()` после загрузки настроек
- `runIndexing()` — полная блокирующая операция, показывать уведомления о прогрессе
- Все сервисы в `ingestion/`, `graph/`, `generation/` — zero Obsidian dependency
- `pdfjs-dist` — единственная внешняя зависимость, бандлится в main.js через esbuild
- Перед добавлением нового npm-пакета: проверить, что это pure JS (не native). Native модули не работают в Obsidian плагинах.
- `index.json` — транзакционная запись: write → .tmp → rename. Всегда.
- Сгенерированные `.md` в `nikel/` не удалять при переиндексации — только обновлять существующие и создавать новые.
