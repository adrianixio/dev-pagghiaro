import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-1 flex-col items-center justify-center text-content-muted">
      <lucide-icon name="server" [size]="56" class="mb-4 opacity-50"></lucide-icon>
      <h2 class="font-display text-2xl font-bold text-content dark:text-rustic-200">No project selected</h2>
      <p class="mt-2 max-w-md text-center text-sm">Pick a project in the sidebar, or press
        <kbd class="rounded bg-rustic-200 px-2 py-0.5 font-mono text-xs text-accent dark:bg-rustic-700">Ctrl+K</kbd>
        to search projects and run commands.</p>
    </div>
  `,
})
export class EmptyStateComponent {}
