export function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const t = timeoutSignal(ms)
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      t.signal.addEventListener("abort", () => reject(new Error(`Превышен таймаут (${ms / 1000} сек)`)), { once: true }),
    ),
  ]).finally(() => t.clear()) as Promise<T>
}
