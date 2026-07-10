import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { Command, CommandPaletteService } from '../../services/command-palette.service';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    @if (commandPaletteService.isOpen()) {
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm"
           (click)="close()">
        <div class="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-float transition-colors dark:border-rustic-700 dark:bg-rustic-800"
             (click)="$event.stopPropagation()">
          <div class="flex items-center border-b border-border bg-surface px-4 py-3 transition-colors dark:border-rustic-700 dark:bg-rustic-900">
            <lucide-icon name="search" [size]="20" class="mr-3 text-content-muted"></lucide-icon>
            <input #searchInput type="text"
                   [(ngModel)]="searchQuery"
                   (ngModelChange)="filterCommands()"
                   (keydown)="handleKeydown($event)"
                   placeholder="Type a command or search..."
                   class="flex-1 border-none bg-transparent font-sans text-lg text-content outline-none placeholder-content-muted dark:text-rustic-100"
                   autofocus>
            <div class="flex items-center gap-1 font-sans text-xs text-content-muted">
              <kbd class="rounded border border-border bg-surface px-1.5 py-0.5 dark:border-rustic-700 dark:bg-rustic-800">ESC</kbd> to close
            </div>
          </div>

          <div class="max-h-[60vh] overflow-y-auto py-2">
            @if (filteredCommands.length === 0) {
              <div class="px-4 py-8 text-center font-sans text-content-muted">
                No commands found for "{{ searchQuery }}"
              </div>
            } @else {
              <ul class="px-2">
                @for (cmd of filteredCommands; track cmd.id; let i = $index) {
                  <li>
                    <button class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                            [class]="selectedIndex === i ? 'bg-accent/12 text-accent' : 'text-content dark:text-rustic-300'"
                            (mouseenter)="selectedIndex = i"
                            (click)="executeCommand(cmd)">
                      @if (cmd.icon) {
                        <lucide-icon [name]="cmd.icon" [size]="16"
                                     [class.text-accent]="selectedIndex === i"
                                     [class.text-content-muted]="selectedIndex !== i"></lucide-icon>
                      } @else {
                        <div class="h-4 w-4"></div>
                      }

                      <div class="flex flex-col">
                        <span class="font-sans text-sm font-medium">{{ cmd.title }}</span>
                        @if (cmd.description) {
                          <span class="text-xs text-content-muted"
                                [class.text-accent]="selectedIndex === i">{{ cmd.description }}</span>
                        }
                      </div>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CommandPaletteComponent {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  readonly commandPaletteService = inject(CommandPaletteService);

  searchQuery = '';
  filteredCommands: Command[] = [];
  selectedIndex = 0;

  constructor() {
    effect(() => {
      if (this.commandPaletteService.isOpen()) {
        this.searchQuery = '';
        this.filterCommands();
        setTimeout(() => this.searchInput?.nativeElement.focus(), 50);
      }
    });
  }

  filterCommands(): void {
    const query = this.searchQuery.toLowerCase();
    const allCommands = this.commandPaletteService.commands();
    this.filteredCommands = !query
      ? allCommands
      : allCommands.filter(
          (command) =>
            command.title.toLowerCase().includes(query) ||
            command.description?.toLowerCase().includes(query)
        );
    this.selectedIndex = 0;
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && this.filteredCommands.length > 0) {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
      return;
    }
    if (event.key === 'ArrowUp' && this.filteredCommands.length > 0) {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
      return;
    }
    if (event.key === 'Enter' && this.filteredCommands.length > 0) {
      event.preventDefault();
      this.executeCommand(this.filteredCommands[this.selectedIndex]!);
    }
  }

  executeCommand(command: Command): void {
    command.action();
    this.close();
  }

  close(): void {
    this.commandPaletteService.close();
  }
}
