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
import { TerminalService } from './services/terminal.service';

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
    <div class="flex h-screen w-screen overflow-hidden bg-rustic-50 text-rustic-900 dark:bg-rustic-900 dark:text-rustic-100 font-sans transition-colors duration-300">
      <app-sidebar></app-sidebar>

      <main class="flex-1 flex flex-col min-w-0 relative">
        <app-dashboard></app-dashboard>
        
        @if (terminalService.activeTerminals().length > 0) {
          <div class="h-64 border-t border-rustic-200 dark:border-rustic-700 flex flex-row overflow-x-auto bg-rustic-900">
            @for (active of terminalService.activeTerminals(); track active.serviceId) {
              <div class="flex-1 min-w-[400px] border-r border-rustic-700 dark:border-rustic-800 last:border-r-0">
                <app-terminal [active]="active"></app-terminal>
              </div>
            }
          </div>
        }
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
  readonly terminalService = inject(TerminalService);
}
