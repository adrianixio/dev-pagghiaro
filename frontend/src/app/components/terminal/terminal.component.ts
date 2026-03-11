import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  effect,
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
import { UiService } from '../../services/ui.service';

const LIGHT_TERMINAL_THEME = {
  background: '#f7efe6',
  foreground: '#3d3129',
  cursor: '#556b2f',
  black: '#3d3129',
  red: '#8b0000',
  green: '#556b2f',
  yellow: '#b8860b',
  blue: '#3d6f90',
  magenta: '#b56576',
  cyan: '#4f7d75',
  white: '#faf5f0',
  brightBlack: '#7d685a',
  brightRed: '#a52a2a',
  brightGreen: '#6b8e23',
  brightYellow: '#daa520',
  brightBlue: '#5f9ea0',
  brightMagenta: '#d291bc',
  brightCyan: '#6ea8a1',
  brightWhite: '#fffdf9',
};

const DARK_TERMINAL_THEME = {
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
};

@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="h-full w-full bg-rustic-50 dark:bg-rustic-900 border-t border-rustic-200 dark:border-rustic-700 flex flex-col transition-all duration-300">
      <div class="flex items-center justify-between px-4 py-2 bg-rustic-100 dark:bg-rustic-800 border-b border-rustic-200 dark:border-rustic-700 transition-colors duration-300">
        <div class="flex items-center gap-2 text-rustic-700 dark:text-rustic-200 font-mono text-sm">
          <lucide-icon name="terminal" [size]="14" class="text-country-blue"></lucide-icon>
          <span class="text-country-green">{{ getProjectName(active.projectId) }}</span>
          <span class="text-rustic-400 dark:text-rustic-500">/</span>
          <span class="text-country-blue">{{ active.serviceName }}</span>
        </div>

        <div class="flex items-center gap-2">
          <button class="p-1.5 rounded hover:bg-rustic-200 dark:hover:bg-rustic-700 text-rustic-500 dark:text-rustic-400 hover:text-country-yellow transition-colors"
                  (click)="scrollToBottom()" title="Scroll to Bottom">
            <lucide-icon name="arrow-down-to-line" [size]="14"></lucide-icon>
          </button>
          <button class="p-1.5 rounded hover:bg-rustic-200 dark:hover:bg-rustic-700 text-rustic-500 dark:text-rustic-400 hover:text-country-red transition-colors"
                  (click)="clearTerminal()" title="Clear Logs">
            <lucide-icon name="trash-2" [size]="14"></lucide-icon>
          </button>
          <div class="w-px h-4 bg-rustic-300 dark:bg-rustic-600 mx-1"></div>
          <button class="p-1.5 rounded hover:bg-rustic-200 dark:hover:bg-rustic-700 text-rustic-500 dark:text-rustic-400 hover:text-rustic-900 dark:hover:text-rustic-100 transition-colors"
                  (click)="closeTerminal()" title="Close Terminal">
            <lucide-icon name="x" [size]="14"></lucide-icon>
          </button>
        </div>
      </div>

      <div class="flex-1 relative p-2 transition-colors duration-300"
           [style.backgroundColor]="uiService.darkMode() ? '#1a1412' : '#f7efe6'">
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
  readonly uiService = inject(UiService);

  private terminal?: Terminal;
  private fitAddon?: FitAddon;
  private logsSub?: Subscription;
  private resizeObserver?: ResizeObserver;
  private pendingLogs: LogMessage[] = [];

  constructor() {
    effect(() => {
      const theme = this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
      if (!this.terminal) {
        return;
      }
      this.terminal.options.theme = theme;
      this.fitAddon?.fit();
    });
  }

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
    this.initTerminal();
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
      theme: this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME,
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
    this.terminal.focus();

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
