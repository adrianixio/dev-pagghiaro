import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { UiStatusDotComponent } from './ui-status-dot.component';

@Component({ standalone: true, imports: [UiStatusDotComponent], template: `<ui-status-dot [status]="s"/>` })
class Host { s: any = 'running'; }

describe('UiStatusDotComponent', () => {
  it('maps each status to a distinct class', () => {
    const fixture = TestBed.createComponent(Host);
    const el = () => fixture.nativeElement.querySelector('ui-status-dot span') as HTMLElement;

    fixture.componentInstance.s = 'running'; fixture.detectChanges();
    expect(el().className).toContain('bg-accent');

    fixture.componentInstance.s = 'error'; fixture.detectChanges();
    expect(el().className).toContain('bg-danger');

    fixture.componentInstance.s = 'restarting'; fixture.detectChanges();
    expect(el().className).toContain('bg-warning');

    fixture.componentInstance.s = 'stopped'; fixture.detectChanges();
    expect(el().className).toContain('bg-content-muted');
  });
});
