import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { UiButtonComponent } from './ui-button.component';

@Component({ standalone: true, imports: [UiButtonComponent], template: `<ui-button [variant]="v" (click)="n=n+1">Go</ui-button>` })
class Host { v = 'primary'; n = 0; }

describe('UiButtonComponent', () => {
  it('renders projected label and emits clicks', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toContain('Go');
    btn.click();
    expect(fixture.componentInstance.n).toBe(1);
  });
});
