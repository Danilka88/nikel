export function resolveFetch(): typeof globalThis.fetch {
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis)
  }
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window)
  }
  if (typeof self !== "undefined" && typeof self.fetch === "function") {
    return self.fetch.bind(self)
  }
  throw new Error("fetch API недоступен в этом окружении")
}
