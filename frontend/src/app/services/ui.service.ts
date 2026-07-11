import { Injectable, signal } from '@angular/core';

export interface UiToast {
  id: number;
  title: string;
  message: string;
  tone: 'success' | 'error';
}

@Injectable({
  providedIn: 'root',
})
export class UiService {
  private readonly configOpenSignal = signal(false);
  private readonly editingProjectIdSignal = signal<string | null>(null);
  private readonly logsOpenSignal = signal(false);
  private readonly logsProjectIdSignal = signal<string | null>(null);
  private readonly darkModeSignal = signal<boolean>(this.getInitialDarkMode());
  private readonly sidebarOpenSignal = signal(false);
  private readonly isMobileSignal = signal(this.getInitialIsMobile());
  private readonly toastSignal = signal<UiToast | null>(null);
  private readonly terminalPanelHeightSignal = signal<number>(this.getInitialPanelHeight());
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly configOpen = this.configOpenSignal.asReadonly();
  readonly editingProjectId = this.editingProjectIdSignal.asReadonly();
  readonly logsOpen = this.logsOpenSignal.asReadonly();
  readonly logsProjectId = this.logsProjectIdSignal.asReadonly();
  readonly darkMode = this.darkModeSignal.asReadonly();
  readonly sidebarOpen = this.sidebarOpenSignal.asReadonly();
  readonly isMobile = this.isMobileSignal.asReadonly();
  readonly toast = this.toastSignal.asReadonly();
  readonly terminalPanelHeight = this.terminalPanelHeightSignal.asReadonly();

  constructor() {
    this.applyTheme(this.darkModeSignal());
    this.bindViewportState();
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

  private getInitialIsMobile(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(max-width: 767.98px)').matches;
  }

  private bindViewportState(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 767.98px)');
    this.isMobileSignal.set(mediaQuery.matches);
    mediaQuery.addEventListener('change', (event) => {
      this.isMobileSignal.set(event.matches);
    });
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
    this.closeSidebar();
  }

  closeConfig(): void {
    this.configOpenSignal.set(false);
  }

  openLogs(projectId: string): void {
    this.logsProjectIdSignal.set(projectId);
    this.logsOpenSignal.set(true);
  }

  closeLogs(): void {
    this.logsOpenSignal.set(false);
  }

  openSidebar(): void {
    this.sidebarOpenSignal.set(true);
  }

  closeSidebar(): void {
    this.sidebarOpenSignal.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpenSignal.update((isOpen) => !isOpen);
  }

  showToast(title: string, message: string, tone: UiToast['tone'] = 'success'): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }

    this.toastSignal.set({
      id: Date.now(),
      title,
      message,
      tone,
    });

    this.toastTimer = setTimeout(() => {
      this.dismissToast();
    }, 3800);
  }

  dismissToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }

    this.toastSignal.set(null);
  }

  private getInitialPanelHeight(): number {
    if (typeof localStorage === 'undefined') return 288;
    const stored = Number(localStorage.getItem('dev-pagghiaro-panel-height'));
    return Number.isFinite(stored) && stored > 0 ? this.clampHeight(stored) : 288;
  }

  private clampHeight(px: number): number {
    return Math.min(800, Math.max(120, Math.round(px)));
  }

  setTerminalPanelHeight(px: number): void {
    const clamped = this.clampHeight(px);
    this.terminalPanelHeightSignal.set(clamped);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dev-pagghiaro-panel-height', String(clamped));
    }
  }
}
