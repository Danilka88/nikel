import { NikelCommand, TriggerMatch } from "../types"

export function findTrigger(
  lines: string[],
  commands: NikelCommand[],
  cursorLine: number,
): TriggerMatch | null {
  for (let l = cursorLine; l >= 0; l--) {
    const lineText = lines[l]
    if (lineText === undefined) continue

    for (const cmd of commands) {
      if (!cmd.enabled) continue

      const idx = lineText.indexOf(cmd.trigger)
      if (idx !== -1) {
        return {
          line: l,
          command: cmd,
          input: lineText.slice(idx + cmd.trigger.length).trim(),
        }
      }
    }
  }

  return null
}

export function buildPrompt(command: NikelCommand, input: string): string {
  if (input.includes("{{input}}")) {
    return command.promptTemplate.replace(/\{\{input\}\}/g, input)
  }
  return command.promptTemplate.replace(/\{\{input\}\}/g, input)
}
