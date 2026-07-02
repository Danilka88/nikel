export function formatResponse(text: string, modelName: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ""

  const lines = trimmed.split("\n")
  const quoted = lines.map((l) => `> ${l}`).join("\n")
  return `> **Nikel (${modelName}):**\n${quoted}\n>`
}
