import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiService } from '../../models/project.model';
import { ProjectService } from '../../services/project.service';
import { TerminalService } from '../../services/terminal.service';
import { LucideAngularModule, Play, Square, Terminal, Activity, RefreshCw } from 'lucide-angular';

@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="card p-4 flex flex-col gap-4 transition-all duration-300 hover:border-hacker-500"
         [class.border-neon-green]="service.status === 'running'"
         [class.border-neon-red]="service.status === 'error'"
         [class.border-hacker-400]="service.status === 'restarting'">
      
      <div class="flex justify-between items-start">
        <div>
          <h3 class="text-lg font-bold text-hacker-50 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full"
                  [class.bg-neon-green]="service.status === 'running'"
                  [class.bg-neon-red]="service.status === 'error'"
                  [class.bg-hacker-400]="service.status === 'restarting'"
                  [class.bg-hacker-600]="service.status === 'stopped'">
            </span>
            {{ service.name }}
          </h3>
          <p class="text-xs text-hacker-300 font-mono mt-1 truncate" [title]="service.command">
            > {{ service.command }}
          </p>
        </div>
        
        <div class="flex gap-2">
          @if (service.status === 'stopped' || service.status === 'error') {
            <button class="p-2 rounded-md bg-hacker-700 text-neon-green hover:bg-hacker-600 transition-colors"
                    (click)="startService()" title="Start Service">
              <lucide-icon name="play" [size]="16"></lucide-icon>
            </button>
          } @else {
            <button class="p-2 rounded-md bg-hacker-700 text-neon-yellow hover:bg-hacker-600 transition-colors"
                    (click)="restartService()" title="Restart Service">
              <lucide-icon name="refresh-cw" [size]="16"></lucide-icon>
            </button>
            <button class="p-2 rounded-md bg-hacker-700 text-neon-red hover:bg-hacker-600 transition-colors"
                    (click)="stopService()" title="Stop Service">
              <lucide-icon name="square" [size]="16"></lucide-icon>
            </button>
          }
          <button class="p-2 rounded-md bg-hacker-700 text-neon-blue hover:bg-hacker-600 transition-colors"
                  (click)="openTerminal()" title="Open Terminal">
            <lucide-icon name="terminal" [size]="16"></lucide-icon>
          </button>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4 mt-auto pt-4 border-t border-hacker-700">
        <div class="flex flex-col">
          <span class="text-xs text-hacker-400 uppercase tracking-wider">CPU</span>
          <div class="flex items-end gap-1">
            <span class="text-xl font-mono text-neon-yellow">{{ service.metrics?.cpu | number:'1.1-1' }}</span>
            <span class="text-xs text-hacker-300 mb-1">%</span>
          </div>
          <div class="w-full h-1 bg-hacker-700 rounded-full mt-1 overflow-hidden">
            <div class="h-full bg-neon-yellow transition-all duration-500"
                 [style.width.%]="service.metrics?.cpu || 0"></div>
          </div>
        </div>
        
        <div class="flex flex-col">
          <span class="text-xs text-hacker-400 uppercase tracking-wider">RAM</span>
          <div class="flex items-end gap-1">
            <span class="text-xl font-mono text-neon-pink">{{ service.metrics?.ram | number:'1.0-0' }}</span>
            <span class="text-xs text-hacker-300 mb-1">MB</span>
          </div>
          <div class="w-full h-1 bg-hacker-700 rounded-full mt-1 overflow-hidden">
            <div class="h-full bg-neon-pink transition-all duration-500"
                 [style.width.%]="(service.metrics?.ram || 0) / 1024 * 100"></div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ServiceCardComponent {
  @Input({ required: true }) service!: UiService;
  @Input({ required: true }) projectId!: string;
  
  projectService = inject(ProjectService);
  terminalService = inject(TerminalService);

  startService() {
    this.projectService.startService(this.projectId, this.service.id);
  }

  stopService() {
    this.projectService.stopService(this.projectId, this.service.id);
  }

  restartService() {
    this.projectService.restartService(this.projectId, this.service.id);
  }

  openTerminal() {
    this.terminalService.setActiveTerminal(this.projectId, this.service.id, this.service.name);
  }
}
