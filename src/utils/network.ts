export const LOCALHOST_RE = /\/\/localhost(?=:\d+|$)/

export function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && err.name === "AbortError") return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes("fetch") || msg.includes("Failed to fetch") || msg.includes("NetworkError")
}

export function isLocalhostUrl(url: string): boolean {
  return LOCALHOST_RE.test(url)
}

export function enhanceOllamaError(err: unknown, url: string): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error("Превышен таймаут ожидания ответа от Ollama. Возможно модель перегружена — попробуйте увеличить таймаут в настройках")
  }

  const rawMessage = err instanceof Error ? err.message : String(err)
  const errType = err instanceof Error ? err.constructor.name : typeof err

  if (err instanceof TypeError && rawMessage.includes("fetch")) {
    return new Error(
      `Не удалось выполнить запрос к Ollama по адресу ${url}. ` +
      `Ошибка: ${rawMessage}. ` +
      "Проверьте: 1) Ollama запущен (ollama serve) 2) брандмауэр не блокирует порт 11434",
    )
  }

  return new Error(`Ошибка (${errType}): ${rawMessage}`)
}
