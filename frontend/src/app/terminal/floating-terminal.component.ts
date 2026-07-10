import { Component, ElementRef, Input, inject } from '@angular/core';
import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import { TerminalManager, OpenTerminal } from './terminal-manager.service';
import { TerminalViewComponent } from './terminal-view.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-floating-terminal',
  standalone: true,
  imports: [CdkDrag, TerminalViewComponent, UiIconButtonComponent, UiStatusDotComponent],
  template: `
    <div cdkDrag cdkDragBoundary=".shell-main" cdkDragHandle="false"
      (cdkDragEnded)="onDragEnd($event)" (mousedown)="mgr.bringToFront(terminal.serviceId)"
      class="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-rustic-700 bg-rustic-950 shadow-float"
      [style.left.px]="terminal.float.maximized ? 8 : terminal.float.x"
      [style.top.px]="terminal.float.maximized ? 8 : terminal.float.y"
      [style.width.px]="terminal.float.maximized ? null : terminal.float.width"
      [style.height.px]="terminal.float.maximized ? null : terminal.float.height"
      [class.inset-2]="terminal.float.maximized"
      [style.zIndex]="mgr.zIndexMap[terminal.serviceId] || 1">
      <div cdkDragHandle class="flex cursor-move items-center gap-2 bg-rustic-900 px-3 py-1.5 text-sm text-rustic-200">
        <ui-status-dot [status]="status"></ui-status-dot>
        <span class="truncate">{{ terminal.serviceName }}</span>
        <span class="ml-auto flex items-center gap-1">
          <ui-icon-button icon="pin" label="Dock" (click)="mgr.dock(terminal.serviceId)"></ui-icon-button>
          <ui-icon-button [icon]="terminal.float.maximized ? 'minimize-2' : 'maximize-2'" label="Maximize" (click)="mgr.toggleMaximize(terminal.serviceId)"></ui-icon-button>
          <ui-icon-button icon="x" label="Close" tone="danger" (click)="mgr.close(terminal.serviceId)"></ui-icon-button>
        </span>
      </div>
      <div class="relative min-h-0 flex-1">
        <app-terminal-view [terminal]="terminal"></app-terminal-view>
      </div>
      @if (!terminal.float.maximized) {
        <div class="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize" (mousedown)="startResize($event)"></div>
      }
    </div>
  `,
})
export class FloatingTerminalComponent {
  @Input({ required: true }) terminal!: OpenTerminal;
  @Input() status: ServiceStatus = 'running';
  readonly mgr = inject(TerminalManager);
  private readonly elRef = inject(ElementRef<HTMLElement>);

  onDragEnd(event: CdkDragEnd): void {
    const pos = event.source.getFreeDragPosition();
    this.mgr.setFloatGeometry(this.terminal.serviceId, {
      x: this.terminal.float.x + pos.x,
      y: this.terminal.float.y + pos.y,
    });
    event.source.reset();
  }

  startResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    const startW = this.terminal.float.width, startH = this.terminal.float.height;
    const move = (e: MouseEvent) => this.mgr.setFloatGeometry(this.terminal.serviceId, {
      width: Math.max(280, startW + (e.clientX - startX)),
      height: Math.max(180, startH + (e.clientY - startY)),
    });
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
}
