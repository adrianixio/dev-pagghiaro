import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { LucideAngularModule } from 'lucide-angular';
import { OpenTerminal } from './terminal-manager.service';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-terminal-tab',
  standalone: true,
  imports: [UiStatusDotComponent, LucideAngularModule],
  template: `
    <div (click)="select.emit()"
      class="group flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 text-sm cursor-pointer transition-colors"
      [class]="active
        ? 'bg-rustic-950 text-rustic-50 border-rustic-800'
        : 'bg-rustic-800 text-rustic-300 border-rustic-800 hover:bg-rustic-700'">
      <ui-status-dot [status]="status"></ui-status-dot>
      <span class="max-w-[10rem] truncate">{{ terminal.serviceName }}</span>
      <button type="button" (click)="$event.stopPropagation(); close.emit()"
        class="opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Close terminal">
        <lucide-icon name="x" [size]="13"></lucide-icon>
      </button>
    </div>
  `,
})
export class TerminalTabComponent {
  @Input({ required: true }) terminal!: OpenTerminal;
  @Input() active = false;
  @Input() status: ServiceStatus = 'running';
  @Output() select = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
}
