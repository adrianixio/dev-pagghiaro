import { TestBed } from '@angular/core/testing';
import { UiService } from './ui.service';

describe('UiService layout state', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });

  it('clamps and persists terminal panel height', () => {
    const ui = TestBed.inject(UiService);
    ui.setTerminalPanelHeight(50);   // below min
    expect(ui.terminalPanelHeight()).toBe(120);
    ui.setTerminalPanelHeight(2000); // above max
    expect(ui.terminalPanelHeight()).toBe(800);
    ui.setTerminalPanelHeight(300);
    expect(ui.terminalPanelHeight()).toBe(300);
    expect(localStorage.getItem('dev-pagghiaro-panel-height')).toBe('300');
  });
});
