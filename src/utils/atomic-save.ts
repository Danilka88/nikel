import * as fs from "fs/promises"
import * as path from "path"

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = filePath + ".tmp"
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  await fs.rename(tmpPath, filePath)
}
