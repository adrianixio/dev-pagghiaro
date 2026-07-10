import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, effect, inject } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Subscription } from 'rxjs';
import { TerminalService } from '../services/terminal.service';
import { UiService } from '../services/ui.service';
import { LogMessage } from '../models/project.model';
import { OpenTerminal } from './terminal-manager.service';

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
} as const;

const DARK_TERMINAL_THEME = {
  background: '#120d0c',
  foreground: '#f4e4d8',
  cursor: '#7b8f4a',
  black: '#3f312b',
  red: '#b85c52',
  green: '#7b8f4a',
  yellow: '#cfa14a',
  blue: '#6c95b0',
  magenta: '#b98294',
  cyan: '#6f9e99',
  white: '#f4e4d8',
  brightBlack: '#5d4a41',
  brightRed: '#cf786d',
  brightGreen: '#97ad63',
  brightYellow: '#e0bc72',
  brightBlue: '#88afc5',
  brightMagenta: '#d6a2b3',
  brightCyan: '#8eb7b1',
  brightWhite: '#faf5f0',
} as const;

@Component({
  selector: 'app-terminal-view',
  standalone: true,
  host: { class: 'relative block h-full w-full' },
  template: `<div #host class="absolute inset-0 p-2"></div>`,
})
export class TerminalViewComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) terminal!: OpenTerminal;
  @ViewChild('host') host!: ElementRef<HTMLElement>;

  private readonly terminalService = inject(TerminalService);
  private readonly uiService = inject(UiService);
  private xterm?: Terminal;
  private fitAddon?: FitAddon;
  private logsSub?: Subscription;
  private resizeObserver?: ResizeObserver;
  private pending: LogMessage[] = [];

  constructor() {
    effect(() => {
      const theme = this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
      if (!this.xterm) return;
      this.xterm.options.theme = theme as any;
      this.fitAddon?.fit();
    });
  }

  ngOnInit(): void {
    this.logsSub = this.terminalService.logs$.subscribe((log) => {
      if (log.projectId !== this.terminal.projectId || log.serviceId !== this.terminal.serviceId) return;
      if (log.type === 'system' && log.data === '\x1b[2J\x1b[H') { this.xterm ? this.xterm.clear() : (this.pending = []); return; }
      this.xterm ? this.xterm.write(log.data) : this.pending.push(log);
    });
  }

  ngAfterViewInit(): void { this.init(); }

  refit(): void {
    if (!this.fitAddon || !this.xterm) return;
    this.fitAddon.fit();
    this.terminalService.sendResize(this.terminal.serviceId, this.xterm.cols, this.xterm.rows);
  }

  clear(): void { this.terminalService.clearTerminal(this.terminal.projectId, this.terminal.serviceId); }

  ngOnDestroy(): void {
    this.logsSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();
  }

  private init(): void {
    this.xterm = new Terminal({
      theme: (this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME) as any,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
      fontSize: 13, cursorBlink: true, convertEol: true, disableStdin: false,
    });
    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.open(this.host.nativeElement);
    this.fitAddon.fit();
    this.xterm.onData((data) => this.terminalService.sendInput(this.terminal.serviceId, data));
    this.xterm.onResize(({ cols, rows }) => this.terminalService.sendResize(this.terminal.serviceId, cols, rows));
    for (const log of this.pending) this.xterm.write(log.data);
    this.pending = [];
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.host.nativeElement);
  }
}
