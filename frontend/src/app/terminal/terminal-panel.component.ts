import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TerminalManager } from './terminal-manager.service';
import { UiService } from '../services/ui.service';
import { ProjectService } from '../services/project.service';
import { TerminalTabComponent } from './terminal-tab.component';
import { TerminalViewComponent } from './terminal-view.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-terminal-panel',
  standalone: true,
  imports: [CommonModule, TerminalTabComponent, TerminalViewComponent, UiIconButtonComponent],
  template: `
    @if (mgr.dockedTerminals().length > 0) {
      <div class="flex flex-col border-t border-rustic-800 bg-rustic-950"
           [style.height.px]="maximized ? null : ui.terminalPanelHeight()"
           [class.flex-1]="maximized">
        <div class="relative h-1.5 cursor-row-resize bg-rustic-900 hover:bg-accent/40"
             (mousedown)="startResize($event)"></div>
        <div class="flex items-end justify-between gap-2 bg-rustic-900 px-2 pt-1">
          <div class="flex items-end gap-1 overflow-x-auto">
            @for (t of mgr.dockedTerminals(); track t.serviceId) {
              <app-terminal-tab [terminal]="t" [active]="mgr.activeId() === t.serviceId"
                [status]="statusOf(t.serviceId)"
                (select)="mgr.activate(t.serviceId)" (close)="mgr.close(t.serviceId)">
              </app-terminal-tab>
            }
          </div>
          <div class="flex items-center gap-1 pb-1">
            <ui-icon-button icon="columns-2" label="Split" (click)="splitActive()"></ui-icon-button>
            <ui-icon-button icon="external-link" label="Pop out" (click)="floatActive()"></ui-icon-button>
            <ui-icon-button [icon]="maximized ? 'minimize-2' : 'maximize-2'" label="Maximize" (click)="maximized = !maximized"></ui-icon-button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1">
          @for (t of mgr.dockedTerminals(); track t.serviceId) {
            <div class="min-w-0 flex-1 border-r border-rustic-800 last:border-r-0" [class.hidden]="!isVisible(t.serviceId)">
              <app-terminal-view [terminal]="t"></app-terminal-view>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class TerminalPanelComponent {
  readonly mgr = inject(TerminalManager);
  readonly ui = inject(UiService);
  private readonly projectService = inject(ProjectService);
  maximized = false;

  isVisible(serviceId: string): boolean {
    const split = this.mgr.splitIds();
    if (split.length > 0) return split.includes(serviceId);
    const active = this.mgr.activeId() ?? this.mgr.dockedTerminals()[0]?.serviceId;
    return serviceId === active;
  }

  statusOf(serviceId: string): ServiceStatus {
    for (const p of this.projectService.projects()) {
      const s = p.services.find((svc) => svc.id === serviceId);
      if (s) return s.status;
    }
    return 'running';
  }

  splitActive() { const id = this.mgr.activeId(); if (id) this.mgr.toggleSplit(id); }
  floatActive() { const id = this.mgr.activeId(); if (id) this.mgr.float(id); }

  startResize(event: MouseEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startH = this.ui.terminalPanelHeight();
    const move = (e: MouseEvent) => this.ui.setTerminalPanelHeight(startH + (startY - e.clientY));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
}
