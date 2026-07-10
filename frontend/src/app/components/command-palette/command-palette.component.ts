import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { Command, CommandPaletteService } from '../../services/command-palette.service';
import { ProjectService } from '../../services/project.service';
import { TerminalService } from '../../services/terminal.service';
import { UiService } from '../../services/ui.service';

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
  readonly projectService = inject(ProjectService);
  readonly terminalService = inject(TerminalService);
  readonly uiService = inject(UiService);

  searchQuery = '';
  filteredCommands: Command[] = [];
  selectedIndex = 0;
  private allCommands: Command[] = [];

  constructor() {
    effect(() => {
      if (this.commandPaletteService.isOpen()) {
        this.buildCommands();
        this.searchQuery = '';
        this.filterCommands();
        setTimeout(() => this.searchInput?.nativeElement.focus(), 50);
      }
    });
  }

  filterCommands(): void {
    const query = this.searchQuery.toLowerCase();
    this.filteredCommands = !query
      ? this.allCommands
      : this.allCommands.filter(
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

  private buildCommands(): void {
    const commands: Command[] = [
      {
        id: 'global:new-project',
        title: 'Create New Project',
        description: 'Open an empty project form',
        icon: 'plus',
        action: () => this.uiService.openNewProject(),
      },
      {
        id: 'global:settings',
        title: 'Open Project Configuration',
        description: 'Edit the active project and its services',
        icon: 'settings',
        action: () => this.uiService.openConfig(this.projectService.activeProjectId()),
      },
    ];

    for (const project of this.projectService.projects()) {
      commands.push({
        id: `project:switch:${project.id}`,
        title: `Switch to Project: ${project.name}`,
        description: project.rootPath,
        icon: 'folder',
        action: () => this.projectService.setActiveProject(project.id),
      });
    }

    const activeProject = this.projectService.activeProject();
    if (activeProject) {
      commands.push(
        {
          id: `project:start-all:${activeProject.id}`,
          title: 'Start All Services',
          description: `Start all services in ${activeProject.name}`,
          icon: 'play',
          action: () => void this.projectService.startAllServices(activeProject.id),
        },
        {
          id: `project:restart-all:${activeProject.id}`,
          title: 'Restart All Services',
          description: `Restart all services in ${activeProject.name}`,
          icon: 'refresh-cw',
          action: () => void this.projectService.restartAllServices(activeProject.id),
        },
        {
          id: `project:stop-all:${activeProject.id}`,
          title: 'Stop All Services',
          description: `Stop all services in ${activeProject.name}`,
          icon: 'square',
          action: () => void this.projectService.stopAllServices(activeProject.id),
        },
        {
          id: `project:reload-context:${activeProject.id}`,
          title: 'Reload Process Context',
          description: `Reload env files and restart active services in ${activeProject.name}`,
          icon: 'rotate-cw',
          action: () => void this.projectService.reloadProjectContext(activeProject.id),
        },
        {
          id: `project:edit:${activeProject.id}`,
          title: `Edit Project: ${activeProject.name}`,
          description: 'Open the configuration form for this project',
          icon: 'settings',
          action: () => this.uiService.openConfig(activeProject.id),
        }
      );

      for (const service of activeProject.services) {
        commands.push({
          id: `service:terminal:${service.id}`,
          title: `Open Terminal: ${service.name}`,
          description: `View logs for ${service.command}`,
          icon: 'terminal',
          action: () => this.terminalService.toggleTerminal(activeProject.id, service.id, service.name),
        });

        if (service.status === 'running' || service.status === 'restarting') {
          commands.push(
            {
              id: `service:restart:${service.id}`,
              title: `Restart Service: ${service.name}`,
              description: service.command,
              icon: 'refresh-cw',
              action: () => void this.projectService.restartService(activeProject.id, service.id),
            },
            {
              id: `service:stop:${service.id}`,
              title: `Stop Service: ${service.name}`,
              description: service.command,
              icon: 'square',
              action: () => void this.projectService.stopService(activeProject.id, service.id),
            }
          );
        } else {
          commands.push({
            id: `service:start:${service.id}`,
            title: `Start Service: ${service.name}`,
            description: service.command,
            icon: 'play',
            action: () => void this.projectService.startService(activeProject.id, service.id),
          });
        }
      }
    }

    this.allCommands = commands;
  }
}
