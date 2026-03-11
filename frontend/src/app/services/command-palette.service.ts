import { Injectable, signal } from '@angular/core';

export interface Command {
  id: string;
  title: string;
  description?: string;
  action: () => void;
  icon?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CommandPaletteService {
  private isOpenSignal = signal(false);
  readonly isOpen = this.isOpenSignal.asReadonly();

  private commandsSignal = signal<Command[]>([]);
  readonly commands = this.commandsSignal.asReadonly();

  constructor() {
    // Listen for Ctrl+K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.isOpenSignal()) {
        this.close();
      }
    });
  }

  open() {
    this.isOpenSignal.set(true);
  }

  close() {
    this.isOpenSignal.set(false);
  }

  toggle() {
    this.isOpenSignal.update(v => !v);
  }

  registerCommands(commands: Command[]) {
    this.commandsSignal.update(current => [...current, ...commands]);
  }

  clearCommands() {
    this.commandsSignal.set([]);
  }
}
