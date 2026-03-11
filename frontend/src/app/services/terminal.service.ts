import { inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { WsClientMessage, WsServerMessage } from '@dev-pagghiaro/shared';
import { LogMessage } from '../models/project.model';
import { ProjectService } from './project.service';

const WS_BASE = '/ws/logs';
const API_BASE = '/api';

@Injectable({
  providedIn: 'root',
})
export class TerminalService {
  private readonly logsSubject = new Subject<LogMessage>();
  readonly logs$ = this.logsSubject.asObservable();

  private readonly activeTerminalSignal = signal<{
    projectId: string;
    serviceId: string;
    serviceName: string;
  } | null>(null);
  readonly activeTerminal = this.activeTerminalSignal.asReadonly();

  private ws: WebSocket | null = null;
  private readonly projectService = inject(ProjectService);

  setActiveTerminal(projectId: string, serviceId: string, serviceName: string): void {
    this.activeTerminalSignal.set({ projectId, serviceId, serviceName });
    this.connectWs(projectId, serviceId);
  }

  sendInput(data: string): void {
    const active = this.activeTerminalSignal();
    if (!active || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: WsClientMessage = {
      type: 'input',
      serviceId: active.serviceId,
      data,
    };
    this.ws.send(JSON.stringify(message));
  }

  sendResize(cols: number, rows: number): void {
    const active = this.activeTerminalSignal();
    if (!active || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: WsClientMessage = {
      type: 'resize',
      serviceId: active.serviceId,
      cols,
      rows,
    };
    this.ws.send(JSON.stringify(message));
  }

  async clearTerminal(): Promise<void> {
    const active = this.activeTerminalSignal();
    if (!active) {
      return;
    }

    this.logsSubject.next({
      projectId: active.projectId,
      serviceId: active.serviceId,
      timestamp: Date.now(),
      data: '\x1b[2J\x1b[H',
      type: 'system',
    });

    try {
      await fetch(`${API_BASE}/projects/${active.projectId}/services/${active.serviceId}/clear-logs`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Error clearing terminal history:', error);
    }
  }

  closeTerminal(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.activeTerminalSignal.set(null);
  }

  private connectWs(projectId: string, serviceId: string): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${globalThis.location.host}${WS_BASE}/${serviceId}`);

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsServerMessage;

        if (message.type === 'log') {
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
          this.logsSubject.next({
            projectId,
            serviceId: message.serviceId,
            timestamp: message.timestamp,
            data: '\x1b[2J\x1b[H',
            type: 'system',
          });
          return;
        }

        this.logsSubject.next({
          projectId,
          serviceId: message.serviceId,
          timestamp: Date.now(),
          data: `\x1b[31m[ERROR] ${message.message}\x1b[0m\r\n`,
          type: 'stderr',
        });
      } catch (error) {
        console.error('Error parsing WS message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
}
