const TYPE_DIR_MAP: Record<string, string> = {
  material: "materials",
  experiment: "experiments",
  property: "properties",
  mode: "modes",
  equipment: "equipment",
  team: "teams",
  person: "persons",
  conclusion: "conclusions",
  topic: "topics",
}

const DEFAULT_DIR = "other"

export function getSubDir(type: string): string {
  return TYPE_DIR_MAP[type] || DEFAULT_DIR
}

export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
