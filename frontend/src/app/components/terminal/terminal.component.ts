import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  effect,
  inject,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Subscription } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../../services/project.service';
import { TerminalService } from '../../services/terminal.service';

@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="h-64 bg-hacker-900 border-t border-hacker-700 flex flex-col transition-all duration-300"
         [class.h-0]="!terminalService.activeTerminal()"
         [class.opacity-0]="!terminalService.activeTerminal()"
         [class.overflow-hidden]="!terminalService.activeTerminal()">
      @if (terminalService.activeTerminal(); as active) {
        <div class="flex items-center justify-between px-4 py-2 bg-hacker-800 border-b border-hacker-700">
          <div class="flex items-center gap-2 text-hacker-200 font-mono text-sm">
            <lucide-icon name="terminal" [size]="14" class="text-neon-blue"></lucide-icon>
            <span class="text-neon-green">{{ getProjectName(active.projectId) }}</span>
            <span class="text-hacker-500">/</span>
            <span class="text-neon-blue">{{ active.serviceName }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button class="p-1.5 rounded hover:bg-hacker-700 text-hacker-400 hover:text-neon-yellow transition-colors"
                    (click)="scrollToBottom()" title="Scroll to Bottom">
              <lucide-icon name="arrow-down-to-line" [size]="14"></lucide-icon>
            </button>
            <button class="p-1.5 rounded hover:bg-hacker-700 text-hacker-400 hover:text-neon-red transition-colors"
                    (click)="clearTerminal()" title="Clear Logs">
              <lucide-icon name="trash-2" [size]="14"></lucide-icon>
            </button>
            <div class="w-px h-4 bg-hacker-600 mx-1"></div>
            <button class="p-1.5 rounded hover:bg-hacker-700 text-hacker-400 hover:text-hacker-100 transition-colors"
                    (click)="closeTerminal()" title="Close Terminal">
              <lucide-icon name="x" [size]="14"></lucide-icon>
            </button>
          </div>
        </div>

        <div class="flex-1 relative bg-[#0a0a0a] p-2">
          <div #terminalContainer class="absolute inset-0 p-2"></div>
        </div>
      }
    </div>
  `,
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  @ViewChild('terminalContainer') terminalContainer!: ElementRef<HTMLElement>;

  readonly terminalService = inject(TerminalService);
  readonly projectService = inject(ProjectService);

  private terminal?: Terminal;
  private fitAddon?: FitAddon;
  private logsSub?: Subscription;
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      const active = this.terminalService.activeTerminal();
      if (active && this.terminalContainer) {
        setTimeout(() => {
          if (!this.terminal) {
            this.initTerminal();
          }
          this.terminal?.clear();
          this.fitAddon?.fit();
          if (this.terminal) {
            this.terminalService.sendResize(this.terminal.cols, this.terminal.rows);
            this.terminal.focus();
          }
        }, 50);
      }
    });
  }

  ngAfterViewInit(): void {
    // Terminal bootstraps lazily when a service is selected.
  }

  getProjectName(projectId: string): string {
    return this.projectService.projects().find((project) => project.id === projectId)?.name ?? 'Unknown';
  }

  scrollToBottom(): void {
    this.terminal?.scrollToBottom();
  }

  clearTerminal(): void {
    this.terminalService.clearTerminal();
  }

  closeTerminal(): void {
    this.terminalService.closeTerminal();
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
        background: '#0a0a0a',
        foreground: '#cccccc',
        cursor: '#00ff00',
        black: '#000000',
        red: '#ff0033',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#00ffff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#ff3366',
        brightGreen: '#33ff33',
        brightYellow: '#ffff33',
        brightBlue: '#33ffff',
        brightMagenta: '#ff33ff',
        brightCyan: '#33ffff',
        brightWhite: '#ffffff',
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
      this.terminalService.sendInput(data);
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.terminalService.sendResize(cols, rows);
    });

    this.logsSub = this.terminalService.logs$.subscribe((log) => {
      const active = this.terminalService.activeTerminal();
      if (!active || log.projectId !== active.projectId || log.serviceId !== active.serviceId) {
        return;
      }

      if (log.type === 'system' && log.data === '\x1b[2J\x1b[H') {
        this.terminal?.clear();
        return;
      }

      this.terminal?.write(log.data);
    });

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.fitAddon || !this.terminal) {
        return;
      }
      this.fitAddon.fit();
      this.terminalService.sendResize(this.terminal.cols, this.terminal.rows);
    });
    this.resizeObserver.observe(this.terminalContainer.nativeElement);
  }
}
