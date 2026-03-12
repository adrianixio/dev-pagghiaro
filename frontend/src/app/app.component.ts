import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
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
      @if (uiService.isMobile() && uiService.sidebarOpen()) {
        <button
          type="button"
          class="fixed inset-0 z-30 bg-rustic-950/50 backdrop-blur-[1px] md:hidden"
          (click)="uiService.closeSidebar()"
          aria-label="Close sidebar overlay"
        ></button>
      }

      <app-sidebar></app-sidebar>

      <main class="flex-1 flex min-h-0 flex-col min-w-0 relative">
        <div class="flex items-center gap-3 border-b border-rustic-200 bg-rustic-50/95 px-4 py-3 backdrop-blur-sm dark:border-rustic-700 dark:bg-rustic-900/95 md:hidden">
          <button
            type="button"
            class="rounded-md border border-rustic-200 bg-white p-2 text-country-green shadow-sm transition-colors hover:bg-rustic-100 dark:border-rustic-700 dark:bg-rustic-800 dark:hover:bg-rustic-700"
            (click)="uiService.openSidebar()"
            [attr.aria-controls]="'app-sidebar'"
            [attr.aria-expanded]="uiService.sidebarOpen()"
            aria-label="Open sidebar"
          >
            <span class="flex h-[18px] w-[18px] flex-col justify-between" aria-hidden="true">
              <span class="block h-0.5 rounded-full bg-current"></span>
              <span class="block h-0.5 rounded-full bg-current"></span>
              <span class="block h-0.5 rounded-full bg-current"></span>
            </span>
          </button>
          <div class="min-w-0">
            <div class="text-sm font-bold tracking-[0.18em] text-country-green uppercase">DevPagghiaro</div>
            <div class="text-[11px] text-rustic-500 dark:text-rustic-400 truncate">Projects and services</div>
          </div>
        </div>

        <app-dashboard></app-dashboard>
        
        @if (terminalService.activeTerminals().length > 0) {
          <div class="h-64 border-t border-rustic-200 dark:border-rustic-700 flex flex-row overflow-x-auto bg-rustic-100 dark:bg-rustic-950 transition-colors duration-300">
            @for (active of terminalService.activeTerminals(); track active.serviceId) {
              <div class="flex-1 min-w-[400px] border-r border-rustic-200 dark:border-rustic-800 last:border-r-0">
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

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.uiService.isMobile() && this.uiService.sidebarOpen()) {
      this.uiService.closeSidebar();
    }
  }
}
