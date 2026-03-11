import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { ConfigFormComponent } from './components/config-form/config-form.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TerminalComponent } from './components/terminal/terminal.component';
import { CommandPaletteService } from './services/command-palette.service';
import { UiService } from './services/ui.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    SidebarComponent,
    DashboardComponent,
    TerminalComponent,
    CommandPaletteComponent,
    ConfigFormComponent,
  ],
  template: `
    <div class="flex h-screen w-screen overflow-hidden bg-hacker-900 text-hacker-100 font-sans">
      <app-sidebar></app-sidebar>

      <main class="flex-1 flex flex-col min-w-0 relative">
        <app-dashboard></app-dashboard>
        <app-terminal></app-terminal>
      </main>

      <app-command-palette></app-command-palette>
      @if (uiService.configOpen()) {
        <app-config-form></app-config-form>
      }
    </div>
  `,
})
export class AppComponent {
  readonly title = 'DevPagghiaro';
  readonly commandPaletteService = inject(CommandPaletteService);
  readonly uiService = inject(UiService);
}
