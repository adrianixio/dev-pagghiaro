import type { WsClientMessage, WsServerMessage } from '@dev-pagghiaro/shared';
import { inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { LogMessage } from '../models/project.model';
import { ProjectService } from './project.service';

const WS_BASE = '/ws/logs';
const API_BASE = '/api';
const MAX_RETAINED_TRANSCRIPT_CHARS = 200_000;
const MAX_RETAINED_LINES = 5_000;
const ESCAPE = '\u001b';
const BELL = '\u0007';

interface TerminalTranscript {
  raw: string;
  plain: string;
  lines: Array<{ text: string; timestamp: number }>;
}

const EMPTY_TERMINAL_TRANSCRIPT: TerminalTranscript = {
  raw: '',
  plain: '',
  lines: [],
};

@Injectable({
  providedIn: 'root',
})
export class TerminalService {
  private readonly logsSubject = new Subject<LogMessage>();
  readonly logs$ = this.logsSubject.asObservable();

  private readonly activeTerminalsSignal = signal<{
    projectId: string;
    serviceId: string;
    serviceName: string;
  }[]>([]);
  readonly activeTerminals = this.activeTerminalsSignal.asReadonly();

  private readonly transcriptSignal = signal<Record<string, TerminalTranscript>>({});

  private wsConnections = new Map<string, WebSocket>();
  private readonly projectService = inject(ProjectService);

  toggleTerminal(projectId: string, serviceId: string, serviceName: string): void {
    const current = this.activeTerminalsSignal();
    const exists = current.find((terminal) => terminal.serviceId === serviceId);

    if (exists) {
      this.closeTerminal(serviceId);
    } else {
      this.clearRetainedTranscript(serviceId);
      this.activeTerminalsSignal.set([...current, { projectId, serviceId, serviceName }]);
      this.connectWs(projectId, serviceId);
    }
  }

  getRawTranscript(serviceId: string): string {
    return this.transcriptSignal()[serviceId]?.raw ?? '';
  }

  getPlainTranscript(serviceId: string): string {
    return this.transcriptSignal()[serviceId]?.plain ?? '';
  }

  /** Returns all stored log lines with their server-side timestamps. Used by the search modal. */
  getTranscriptLines(serviceId: string): Array<{ text: string; timestamp: number }> {
    return this.transcriptSignal()[serviceId]?.lines ?? [];
  }

  sendInput(serviceId: string, data: string): void {
    const ws = this.wsConnections.get(serviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: WsClientMessage = {
      type: 'input',
      serviceId,
      data,
    };
    ws.send(JSON.stringify(message));
  }

  sendResize(serviceId: string, cols: number, rows: number): void {
    const ws = this.wsConnections.get(serviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: WsClientMessage = {
      type: 'resize',
      serviceId,
      cols,
      rows,
    };
    ws.send(JSON.stringify(message));
  }

  async clearTerminal(projectId: string, serviceId: string): Promise<void> {
    this.clearRetainedTranscript(serviceId);
    this.logsSubject.next({
      projectId,
      serviceId,
      timestamp: Date.now(),
      data: '\x1b[2J\x1b[H',
      type: 'system',
    });

    try {
      await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/clear-logs`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Error clearing terminal history:', error);
    }
  }

  closeTerminal(serviceId: string): void {
    const ws = this.wsConnections.get(serviceId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(serviceId);
    }
    this.activeTerminalsSignal.update((terminals) => terminals.filter((terminal) => terminal.serviceId !== serviceId));
  }

  private connectWs(projectId: string, serviceId: string): void {
    if (this.wsConnections.has(serviceId)) {
      return;
    }

    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${globalThis.location.host}${WS_BASE}/${serviceId}`);
    this.wsConnections.set(serviceId, ws);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsServerMessage;

        if (message.type === 'log') {
          this.appendToTranscript(message.serviceId, message.data, message.timestamp);
          this.logsSubject.next({
            projectId,
            serviceId: message.serviceId,
            timestamp: message.timestamp,
            data: message.data,
            type: 'stdout',
          });
          return;
        }

        if (message.type === 'status') {
          this.projectService.updateServiceStatus(projectId, message.serviceId, message.status);
          return;
        }

        if (message.type === 'metrics') {
          this.projectService.updateServiceMetrics(projectId, message.payload.serviceId, {
            cpu: message.payload.cpu,
            ram: message.payload.memoryBytes / (1024 * 1024),
          });
          return;
        }

        if (message.type === 'cleared') {
          this.clearRetainedTranscript(message.serviceId);
          this.logsSubject.next({
            projectId,
            serviceId: message.serviceId,
            timestamp: message.timestamp,
            data: '\x1b[2J\x1b[H',
            type: 'system',
          });
          return;
        }

        const errorLog = `\x1b[31m[ERROR] ${message.message}\x1b[0m\r\n`;
        this.appendToTranscript(message.serviceId, errorLog, Date.now());
        this.logsSubject.next({
          projectId,
          serviceId: message.serviceId,
          timestamp: Date.now(),
          data: errorLog,
          type: 'stderr',
        });
      } catch (error) {
        console.error('Error parsing WS message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      this.wsConnections.delete(serviceId);
    };
  }

  private appendToTranscript(serviceId: string, data: string, timestamp: number): void {
    const normalizedData = this.normalizeTranscriptChunk(data);

    const newLines = normalizedData
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({ text, timestamp }));

    this.transcriptSignal.update((transcripts) => {
      const current = transcripts[serviceId] ?? EMPTY_TERMINAL_TRANSCRIPT;
      const merged = [...current.lines, ...newLines];
      return {
        ...transcripts,
        [serviceId]: {
          raw: this.trimRetainedTranscript(current.raw + data),
          plain: this.trimRetainedTranscript(current.plain + normalizedData),
          lines: merged.length > MAX_RETAINED_LINES ? merged.slice(-MAX_RETAINED_LINES) : merged,
        },
      };
    });
  }

  private clearRetainedTranscript(serviceId: string): void {
    this.transcriptSignal.update((transcripts) => ({
      ...transcripts,
      [serviceId]: EMPTY_TERMINAL_TRANSCRIPT,
    }));
  }

  private normalizeTranscriptChunk(data: string): string {
    return this.stripAnsi(data)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  private stripAnsi(data: string): string {
    let result = '';

    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];
      if (char !== ESCAPE) {
        result += char;
        continue;
      }

      const next = data[index + 1];
      if (!next) {
        break;
      }

      if (next === '[') {
        index += 1;
        while (index + 1 < data.length) {
          index += 1;
          const code = data.charCodeAt(index);
          if (code >= 0x40 && code <= 0x7e) {
            break;
          }
        }
        continue;
      }

      if (next === ']') {
        index += 1;
        while (index + 1 < data.length) {
          index += 1;
          const oscChar = data[index];
          if (oscChar === BELL) {
            break;
          }
          if (oscChar === ESCAPE && data[index + 1] === '\\') {
            index += 1;
            break;
          }
        }
        continue;
      }

      index += 1;
    }

    return result;
  }

  private trimRetainedTranscript(transcript: string): string {
    if (transcript.length <= MAX_RETAINED_TRANSCRIPT_CHARS) {
      return transcript;
    }

    return transcript.slice(-MAX_RETAINED_TRANSCRIPT_CHARS);
  }
}
