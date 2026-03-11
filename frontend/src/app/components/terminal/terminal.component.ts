import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
  inject,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Subscription } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../../services/project.service';
import { TerminalService } from '../../services/terminal.service';
import { LogMessage } from '../../models/project.model';

@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="h-full w-full bg-rustic-900 border-t border-rustic-700 flex flex-col transition-all duration-300">
      <div class="flex items-center justify-between px-4 py-2 bg-rustic-800 border-b border-rustic-700">
        <div class="flex items-center gap-2 text-rustic-200 font-mono text-sm">
          <lucide-icon name="terminal" [size]="14" class="text-country-blue"></lucide-icon>
          <span class="text-country-green">{{ getProjectName(active.projectId) }}</span>
          <span class="text-rustic-500">/</span>
          <span class="text-country-blue">{{ active.serviceName }}</span>
        </div>

        <div class="flex items-center gap-2">
          <button class="p-1.5 rounded hover:bg-rustic-700 text-rustic-400 hover:text-country-yellow transition-colors"
                  (click)="scrollToBottom()" title="Scroll to Bottom">
            <lucide-icon name="arrow-down-to-line" [size]="14"></lucide-icon>
          </button>
          <button class="p-1.5 rounded hover:bg-rustic-700 text-rustic-400 hover:text-country-red transition-colors"
                  (click)="clearTerminal()" title="Clear Logs">
            <lucide-icon name="trash-2" [size]="14"></lucide-icon>
          </button>
          <div class="w-px h-4 bg-rustic-600 mx-1"></div>
          <button class="p-1.5 rounded hover:bg-rustic-700 text-rustic-400 hover:text-rustic-100 transition-colors"
                  (click)="closeTerminal()" title="Close Terminal">
            <lucide-icon name="x" [size]="14"></lucide-icon>
          </button>
        </div>
      </div>

      <div class="flex-1 relative bg-[#1a1412] p-2">
        <div #terminalContainer class="absolute inset-0 p-2"></div>
      </div>
    </div>
  `,
})
export class TerminalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) active!: { projectId: string; serviceId: string; serviceName: string };
  @ViewChild('terminalContainer') terminalContainer!: ElementRef<HTMLElement>;

  readonly terminalService = inject(TerminalService);
  readonly projectService = inject(ProjectService);

  private terminal?: Terminal;
  private fitAddon?: FitAddon;
  private logsSub?: Subscription;
  private resizeObserver?: ResizeObserver;
  private pendingLogs: LogMessage[] = [];

  ngOnInit(): void {
    this.logsSub = this.terminalService.logs$.subscribe((log) => {
      if (log.projectId !== this.active.projectId || log.serviceId !== this.active.serviceId) {
        return;
      }

      if (log.type === 'system' && log.data === '\x1b[2J\x1b[H') {
        if (this.terminal) {
          this.terminal.clear();
        } else {
          this.pendingLogs = [];
        }
        return;
      }

      if (this.terminal) {
        this.terminal.write(log.data);
      } else {
        this.pendingLogs.push(log);
      }
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initTerminal();
    }, 50);
  }

  getProjectName(projectId: string): string {
    return this.projectService.projects().find((project) => project.id === projectId)?.name ?? 'Unknown';
  }

  scrollToBottom(): void {
    this.terminal?.scrollToBottom();
  }

  clearTerminal(): void {
    this.terminalService.clearTerminal(this.active.projectId, this.active.serviceId);
  }

  closeTerminal(): void {
    this.terminalService.closeTerminal(this.active.serviceId);
  }

  ngOnDestroy(): void {
    this.logsSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.terminal?.dispose();
  }

  private initTerminal(): void {
    if (!this.terminalContainer) {
      return;
    }

    this.terminal = new Terminal({
      theme: {
        background: '#1a1412',
        foreground: '#f4e4d8',
        cursor: '#556b2f',
        black: '#1a1412',
        red: '#8b0000',
        green: '#556b2f',
        yellow: '#daa520',
        blue: '#4682b4',
        magenta: '#d87093',
        cyan: '#4682b4',
        white: '#f4e4d8',
        brightBlack: '#6b574b',
        brightRed: '#a52a2a',
        brightGreen: '#6b8e23',
        brightYellow: '#f0e68c',
        brightBlue: '#5f9ea0',
        brightMagenta: '#ffb6c1',
        brightCyan: '#87ceeb',
        brightWhite: '#faf5f0',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      disableStdin: false,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalContainer.nativeElement);
    this.fitAddon.fit();

    this.terminal.onData((data) => {
      this.terminalService.sendInput(this.active.serviceId, data);
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.terminalService.sendResize(this.active.serviceId, cols, rows);
    });

    for (const log of this.pendingLogs) {
      this.terminal.write(log.data);
    }
    this.pendingLogs = [];

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.fitAddon || !this.terminal) {
        return;
      }
      this.fitAddon.fit();
      this.terminalService.sendResize(this.active.serviceId, this.terminal.cols, this.terminal.rows);
    });
    this.resizeObserver.observe(this.terminalContainer.nativeElement);
  }
}
