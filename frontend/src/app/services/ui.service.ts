import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class UiService {
  private readonly configOpenSignal = signal(false);
  private readonly editingProjectIdSignal = signal<string | null>(null);

  readonly configOpen = this.configOpenSignal.asReadonly();
  readonly editingProjectId = this.editingProjectIdSignal.asReadonly();

  openConfig(projectId: string | null): void {
    this.editingProjectIdSignal.set(projectId);
    this.configOpenSignal.set(true);
  }

  openNewProject(): void {
    this.openConfig(null);
  }

  closeConfig(): void {
    this.configOpenSignal.set(false);
  }
}
