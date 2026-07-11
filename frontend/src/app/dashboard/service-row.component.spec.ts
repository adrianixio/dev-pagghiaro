import { TestBed } from '@angular/core/testing';
import { Component, importProvidersFrom } from '@angular/core';
import { Activity, ArrowLeftRight, Bug, ChevronDown, ChevronRight, LucideAngularModule, Play, PlugZap, RotateCw, Square, Terminal } from 'lucide-angular';
import { ServiceRowComponent } from './service-row.component';
import { UiService } from '../models/project.model';

const svc: UiService = { id: 's1', name: 'api', command: 'bun run dev', cwd: '.', status: 'running', metrics: { cpu: 12, ram: 128 } } as any;

@Component({
  standalone: true, imports: [ServiceRowComponent],
  template: `<app-service-row [service]="svc" (start)="acted='start'" (openTerminal)="acted='term'" (inspect)="acted='inspect'"></app-service-row>`,
})
class Host { svc = svc; acted = ''; }

describe('ServiceRowComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [importProvidersFrom(LucideAngularModule.pick({ Activity, ArrowLeftRight, Bug, ChevronDown, ChevronRight, Play, RotateCw, Square, Terminal, PlugZap }))],
    });
  });

  it('renders the service name and status, and emits actions', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('api');
    const openBtn = fixture.nativeElement.querySelector('[data-action="open-terminal"] button') as HTMLButtonElement;
    openBtn.click();
    expect(fixture.componentInstance.acted).toBe('term');
  });

  it('emits inspect and shows a neutral health dot when health is unknown', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const inspectBtn = fixture.nativeElement.querySelector('button[aria-label="Inspect"]') as HTMLButtonElement;
    inspectBtn.click();
    expect(fixture.componentInstance.acted).toBe('inspect');
    const healthDot = fixture.nativeElement.querySelector('[title="health: unknown"]') as HTMLElement;
    expect(healthDot.className).toContain('bg-neutral-400');
  });
});
