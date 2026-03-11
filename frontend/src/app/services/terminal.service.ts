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

  private readonly activeTerminalsSignal = signal<{
    projectId: string;
    serviceId: string;
    serviceName: string;
  }[]>([]);
  readonly activeTerminals = this.activeTerminalsSignal.asReadonly();

  private wsConnections = new Map<string, WebSocket>();
  private readonly projectService = inject(ProjectService);

  toggleTerminal(projectId: string, serviceId: string, serviceName: string): void {
    const current = this.activeTerminalsSignal();
    const exists = current.find(t => t.serviceId === serviceId);
    
    if (exists) {
      this.closeTerminal(serviceId);
    } else {
      this.activeTerminalsSignal.set([...current, { projectId, serviceId, serviceName }]);
      this.connectWs(projectId, serviceId);
    }
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
    this.activeTerminalsSignal.update(terminals => terminals.filter(t => t.serviceId !== serviceId));
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

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      this.wsConnections.delete(serviceId);
    };
  }
}
