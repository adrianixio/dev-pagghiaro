import type { LogSeverity } from '@dev-pagghiaro/shared';

export const SEVERITY_RANK: Record<LogSeverity, number> = { info: 0, warn: 1, error: 2 };

const PY_TRACEBACK_HEADER = /^Traceback \(most recent call last\):/;
const ERROR_TYPE = /^[A-Za-z_][\w.]*(Error|Exception):/;
const JS_AT_FRAME = /^\s+at\s+/;
const ERROR_TOKEN = /\b(error|fatal|panic)\b/i;
const WARN_TOKEN = /\b(warn|warning|deprecated)\b/i;

export function createSeverityClassifier(): {
  classify(text: string): { severity: LogSeverity; continuesEvent: boolean };
} {
  let inStack = false;

  return {
    classify(text: string): { severity: LogSeverity; continuesEvent: boolean } {
      const trimmed = text.replace(/^\s+/, '');
      const indented = /^\s+/.test(text) && text.trim() !== '';

      // Un header di traceback Python apre un evento.
      if (PY_TRACEBACK_HEADER.test(trimmed)) {
        inStack = true;
        return { severity: 'error', continuesEvent: false };
      }

      // Righe indentate mentre un evento è aperto = continuazione (frame/codice).
      if (inStack && indented) {
        return { severity: 'error', continuesEvent: true };
      }

      // Una riga non indentata chiude l'eventuale stack aperto.
      inStack = false;

      const isError = ERROR_TYPE.test(trimmed) || JS_AT_FRAME.test(text) || ERROR_TOKEN.test(text);
      if (isError) {
        // Un header "…Error:" apre uno stack JS per agganciare i frame "    at …".
        if (/error:/i.test(trimmed)) {
          inStack = true;
        }
        return { severity: 'error', continuesEvent: false };
      }

      if (WARN_TOKEN.test(text)) {
        return { severity: 'warn', continuesEvent: false };
      }

      return { severity: 'info', continuesEvent: false };
    },
  };
}
