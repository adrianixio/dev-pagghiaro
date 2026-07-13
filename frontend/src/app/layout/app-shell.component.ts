import { Component, HostListener, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconRailComponent } from './icon-rail.component';
import { SidebarComponent } from './sidebar.component';
import { ToolbarComponent } from './toolbar.component';
import { ServiceListComponent } from '../dashboard/service-list.component';
import { TerminalPanelComponent } from '../terminal/terminal-panel.component';
import { FloatingTerminalComponent } from '../terminal/floating-terminal.component';
import { CommandPaletteComponent } from '../components/command-palette/command-palette.component';
import { ConfigFormComponent } from '../components/config-form/config-form.component';
import { LogsPanelComponent } from '../logs/logs-panel.component';
import { IntrospectionPanelComponent } from '../diagnostics/introspection-panel.component';
import { HttpInspectorPanelComponent } from '../http/http-inspector-panel.component';
import { UiService } from '../services/ui.service';
import { ProjectService } from '../services/project.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { ServiceStatus } from '../models/project.model';
import { CommandPaletteService } from '../services/command-palette.service';
import { buildCommands } from '../services/command-registry';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, IconRailComponent, SidebarComponent, ToolbarComponent, ServiceListComponent,
    TerminalPanelComponent, FloatingTerminalComponent, CommandPaletteComponent, ConfigFormComponent, LogsPanelComponent,
    IntrospectionPanelComponent, HttpInspectorPanelComponent],
  template: `
    <div class="flex h-screen w-screen overflow-hidden bg-surface font-sans text-content dark:bg-rustic-900 dark:text-rustic-100">
      @if (ui.isMobile() && ui.sidebarOpen()) {
        <button type="button" class="fixed inset-0 z-30 bg-rustic-950/50 md:hidden" (click)="ui.closeSidebar()" aria-label="Close sidebar"></button>
      }
      <app-icon-rail class="hidden md:flex"></app-icon-rail>
      <app-sidebar></app-sidebar>
      <main class="shell-main relative flex min-w-0 flex-1 flex-col">
        <app-toolbar></app-toolbar>
        <app-service-list></app-service-list>
        <app-terminal-panel></app-terminal-panel>
        <div class="pointer-events-none absolute inset-0 z-20">
          @for (t of mgr.floatingTerminals(); track t.serviceId) {
            <app-floating-terminal [terminal]="t" [status]="statusOf(t.serviceId)"></app-floating-terminal>
          }
        </div>
      </main>
      <app-command-palette></app-command-palette>
      @if (ui.configOpen()) { <app-config-form></app-config-form> }
      @if (ui.logsOpen()) { <app-logs-panel /> }
      @if (ui.introspectTarget()) { <app-introspection-panel /> }
      @if (ui.httpInspectTarget()) { <app-http-inspector-panel /> }
      @if (ui.debugTarget()) { <app-debug-panel /> }
      @if (ui.toast(); as toast) {
        <div class="fixed right-4 top-4 z-[70] w-full max-w-sm rounded-xl border px-4 py-3 shadow-float"
          [class]="toast.tone === 'success' ? 'border-accent/30 bg-accent/12 text-accent' : 'border-danger/30 bg-danger/12 text-danger'">
          <div class="text-sm font-bold uppercase tracking-wide">{{ toast.title }}</div>
          <div class="mt-1 text-sm text-content dark:text-rustic-200">{{ toast.message }}</div>
        </div>
      }
    </div>
  `,
})
export class AppShellComponent {
  readonly ui = inject(UiService);
  readonly mgr = inject(TerminalManager);
  readonly palette = inject(CommandPaletteService);
  private readonly projectService = inject(ProjectService);

  constructor() {
    effect(() => {
      const cmds = buildCommands({
        projects: () => this.projectService.projects(),
        activeProject: () => this.projectService.activeProject(),
        setActiveProject: (id) => this.projectService.setActiveProject(id),
        startService: (p, s) => this.projectService.startService(p, s),
        stopService: (p, s) => this.projectService.stopService(p, s),
        restartService: (p, s) => this.projectService.restartService(p, s),
        killServicePort: (p, s) => { void this.projectService.killServicePort(p, s); },
        startAllServices: (p) => this.projectService.startAllServices(p),
        stopAllServices: (p) => this.projectService.stopAllServices(p),
        restartAllServices: (p) => this.projectService.restartAllServices(p),
        reloadProjectContext: (p) => this.projectService.reloadProjectContext(p),
        openTerminal: (p, s, name) => this.mgr.open(p, s, name),
        toggleDarkMode: () => this.ui.toggleDarkMode(),
        openNewProject: () => this.ui.openNewProject(),
        openConfig: (id) => this.ui.openConfig(id),
        openLogs: (p) => this.ui.openLogs(p),
        inspectService: (p, s) => this.ui.openIntrospect(p, s),
        httpInspect: (p, s) => this.ui.openHttpInspect(p, s),
        debug: (p, s) => this.ui.openDebug(p, s),
      });
      this.palette.clearCommands();
      this.palette.registerCommands(cmds);
    }, { allowSignalWrites: true });
  }

  statusOf(serviceId: string): ServiceStatus {
    for (const p of this.projectService.projects()) {
      const s = p.services.find((svc) => svc.id === serviceId);
      if (s) return s.status;
    }
    return 'running';
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.ui.isMobile() && this.ui.sidebarOpen()) this.ui.closeSidebar(); }
}
