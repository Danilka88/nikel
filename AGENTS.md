# AGENTS.md — для AI-агентов (opencode / Deepseek V4 Flash)

Этот файл описывает архитектуру, конвенции и правила разработки плагина **Nikel** для Obsidian. Следуй этим инструкциям при внесении изменений, чтобы сохранить качество и согласованность кода.

## 1. Архитектура

**Принцип:** тонкий слой Obsidian (main.ts) + чистые сервисы без зависимостей от Obsidian.

```
main.ts (оркестрация, вызовы Obsidian API)
  ├── services/ollama.ts          — HTTP к Ollama (injectable fetch)
  ├── services/trigger-parser.ts  — чистая функция: поиск триггера + сборка промпта
  ├── services/response-formatter.ts — чистая функция: форматирование ответа
  ├── suggester.ts                — EditorSuggest для автокомплита @nik
  └── settings/settings-tab.ts    — вкладка настроек
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

## 6. Важно помнить

- `src/settings.ts` удалён — все настройки в `types.ts` и `settings/settings-tab.ts`
- `src/ollama.ts` удалён — клиент в `services/ollama.ts`
- `NikelPlugin.settings` инициализируется в `loadSettings()` — обязательно вызывать перед использованием
- `NikelPlugin.ollama` инициализируется в `onload()` — не использовать в конструкторе
- Circular dependency: `settings-tab.ts` импортирует `NikelPlugin` (type-only через `import type`), это единственное исключение
