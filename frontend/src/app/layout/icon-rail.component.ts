import { Component, inject } from '@angular/core';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { UiService } from '../services/ui.service';
import { CommandPaletteService } from '../services/command-palette.service';

@Component({
  selector: 'app-icon-rail',
  standalone: true,
  imports: [UiIconButtonComponent],
  host: { class: 'flex w-12 flex-col items-center gap-2 border-r border-rustic-800 bg-rustic-900 py-3' },
  template: `
    <div class="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent font-display text-lg font-bold text-white">P</div>
    <ui-icon-button icon="search" label="Command palette (Ctrl+K)" (click)="palette.open()"></ui-icon-button>
    <ui-icon-button icon="folder-plus" label="New project" (click)="ui.openNewProject()"></ui-icon-button>
    <div class="mt-auto"></div>
    <ui-icon-button [icon]="ui.darkMode() ? 'sun' : 'moon'" label="Toggle theme" (click)="ui.toggleDarkMode()"></ui-icon-button>
  `,
})
export class IconRailComponent {
  readonly ui = inject(UiService);
  readonly palette = inject(CommandPaletteService);
}
