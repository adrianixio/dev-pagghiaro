// Copre CSI/escape ANSI comuni (colori, cursor moves).
const ANSI_PATTERN =
  /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export interface AssembledLine {
  raw: string;
  text: string;
}

export function createLineAssembler(): {
  push(chunk: string): AssembledLine[];
  flush(): AssembledLine[];
} {
  let current = '';
  let pendingCR = false;

  const makeLine = (raw: string): AssembledLine => ({ raw, text: stripAnsi(raw) });

  return {
    push(chunk: string): AssembledLine[] {
      const lines: AssembledLine[] = [];
      for (const ch of chunk) {
        if (ch === '\n') {
          pendingCR = false;
          lines.push(makeLine(current));
          current = '';
        } else if (ch === '\r') {
          pendingCR = true;
        } else {
          if (pendingCR) {
            current = '';
            pendingCR = false;
          }
          current += ch;
        }
      }
      return lines;
    },
    flush(): AssembledLine[] {
      if (current.length === 0) return [];
      const line = makeLine(current);
      current = '';
      pendingCR = false;
      return [line];
    },
  };
}
