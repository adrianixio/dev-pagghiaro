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
    <div class="card p-4 flex flex-col gap-4 transition-all duration-300 hover:border-rustic-400 dark:hover:border-rustic-500"
         [class.border-country-green]="service.status === 'running'"
         [class.border-country-red]="service.status === 'error'"
         [class.border-rustic-400]="service.status === 'restarting'">
      
      <div class="flex justify-between items-start">
       <div>
          <h3 class="text-lg font-bold text-rustic-900 dark:text-rustic-100 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full"
                  [class.bg-country-green]="service.status === 'running'"
                  [class.bg-country-red]="service.status === 'error'"
                  [class.bg-rustic-400]="service.status === 'restarting'"
                  [class.bg-rustic-300]="service.status === 'stopped'">
            </span>
            {{ service.name }}
          </h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-mono border"
                  [ngClass]="isInExecutionPlan()
                    ? 'bg-country-green/15 border-country-green/30 text-country-green'
                    : 'bg-rustic-100 dark:bg-rustic-700 border-rustic-200 dark:border-rustic-600 text-rustic-500 dark:text-rustic-300'">
              {{ isInExecutionPlan() ? 'In Plan' : 'Excluded' }}
            </span>
            @if (isInExecutionPlan()) {
              <span class="rounded-full px-2 py-0.5 text-[11px] font-mono border border-country-blue/30 bg-country-blue/10 text-country-blue">
                #{{ getExecutionIndex() }}
              </span>
            }
          </div>
          <p class="text-xs text-rustic-500 dark:text-rustic-400 font-mono mt-1 truncate" [title]="service.command">
            > {{ service.command }}
          </p>
        </div>
        
        <div class="flex gap-2">
          @if (service.status === 'stopped' || service.status === 'error') {
            <button class="p-2 rounded-md bg-rustic-100 dark:bg-rustic-700 text-country-green hover:bg-rustic-200 dark:hover:bg-rustic-600 transition-colors"
                    (click)="startService()" title="Start Service">
              <lucide-icon name="play" [size]="16"></lucide-icon>
            </button>
          } @else {
            <button class="p-2 rounded-md bg-rustic-100 dark:bg-rustic-700 text-country-yellow hover:bg-rustic-200 dark:hover:bg-rustic-600 transition-colors"
                    (click)="restartService()" title="Restart Service">
              <lucide-icon name="refresh-cw" [size]="16"></lucide-icon>
            </button>
            <button class="p-2 rounded-md bg-rustic-100 dark:bg-rustic-700 text-country-red hover:bg-rustic-200 dark:hover:bg-rustic-600 transition-colors"
                    (click)="stopService()" title="Stop Service">
              <lucide-icon name="square" [size]="16"></lucide-icon>
            </button>
          }
          <button class="p-2 rounded-md bg-rustic-100 dark:bg-rustic-700 text-country-blue hover:bg-rustic-200 dark:hover:bg-rustic-600 transition-colors"
                  (click)="openTerminal()" title="Toggle Terminal">
            <lucide-icon name="terminal" [size]="16"></lucide-icon>
          </button>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4 mt-auto pt-4 border-t border-rustic-200 dark:border-rustic-700">
        <div class="flex flex-col">
          <span class="text-xs text-rustic-500 dark:text-rustic-400 uppercase tracking-wider">CPU</span>
          <div class="flex items-end gap-1">
            <span class="text-xl font-mono text-country-yellow">{{ service.metrics?.cpu | number:'1.1-1' }}</span>
            <span class="text-xs text-rustic-400 dark:text-rustic-500 mb-1">%</span>
          </div>
          <div class="w-full h-1 bg-rustic-200 dark:bg-rustic-700 rounded-full mt-1 overflow-hidden">
            <div class="h-full bg-country-yellow transition-all duration-500"
                 [style.width.%]="service.metrics?.cpu || 0"></div>
          </div>
        </div>
        
        <div class="flex flex-col">
          <span class="text-xs text-rustic-500 dark:text-rustic-400 uppercase tracking-wider">RAM</span>
          <div class="flex items-end gap-1">
            <span class="text-xl font-mono text-country-pink">{{ service.metrics?.ram | number:'1.0-0' }}</span>
            <span class="text-xs text-rustic-400 dark:text-rustic-500 mb-1">MB</span>
          </div>
          <div class="w-full h-1 bg-rustic-200 dark:bg-rustic-700 rounded-full mt-1 overflow-hidden">
            <div class="h-full bg-country-pink transition-all duration-500"
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
    this.terminalService.toggleTerminal(this.projectId, this.service.id, this.service.name);
  }

  isInExecutionPlan(): boolean {
    const project = this.projectService.getProjectById(this.projectId);
    const executionIds = project?.executionOrder?.serviceIds;
    if (!executionIds) {
      return true;
    }
    return executionIds.includes(this.service.id);
  }

  getExecutionIndex(): number {
    const project = this.projectService.getProjectById(this.projectId);
    const executionIds = project?.executionOrder?.serviceIds;
    if (!executionIds) {
      const fallbackIndex = project?.services.findIndex((entry) => entry.id === this.service.id) ?? -1;
      return fallbackIndex >= 0 ? fallbackIndex + 1 : 0;
    }

    const validExecutionIds = executionIds.filter((serviceId) => project?.services.some((entry) => entry.id === serviceId));
    const index = validExecutionIds.indexOf(this.service.id);
    return index >= 0 ? index + 1 : 0;
  }
}
