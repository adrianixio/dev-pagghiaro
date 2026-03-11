import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class UiService {
  private readonly configOpenSignal = signal(false);
  private readonly editingProjectIdSignal = signal<string | null>(null);
  private readonly darkModeSignal = signal<boolean>(this.getInitialDarkMode());

  readonly configOpen = this.configOpenSignal.asReadonly();
  readonly editingProjectId = this.editingProjectIdSignal.asReadonly();
  readonly darkMode = this.darkModeSignal.asReadonly();

  constructor() {
    this.applyTheme(this.darkModeSignal());
  }

  private getInitialDarkMode(): boolean {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return false;
    }
    const stored = localStorage.getItem('dev-pagghiaro-theme');
    if (stored) {
      return stored === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toggleDarkMode(): void {
    const newMode = !this.darkModeSignal();
    this.darkModeSignal.set(newMode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dev-pagghiaro-theme', newMode ? 'dark' : 'light');
    }
    this.applyTheme(newMode);
  }

  private applyTheme(isDark: boolean): void {
    if (typeof document === 'undefined') return;
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

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
