import { TestBed } from '@angular/core/testing';
import { TerminalManager } from './terminal-manager.service';
import { TerminalService } from '../services/terminal.service';
import { ProjectService } from '../services/project.service';

class TerminalServiceStub {
  toggleTerminal() {} closeTerminal() {} sendInput() {} sendResize() {}
  clearTerminal() { return Promise.resolve(); }
  logs$ = { subscribe: () => ({ unsubscribe() {} }) };
}
class ProjectServiceStub { projects() { return []; } }

describe('TerminalManager', () => {
  let mgr: TerminalManager;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TerminalManager,
        { provide: TerminalService, useClass: TerminalServiceStub },
        { provide: ProjectService, useClass: ProjectServiceStub },
      ],
    });
    mgr = TestBed.inject(TerminalManager);
  });

  it('open adds a docked terminal and makes it active', () => {
    mgr.open('p1', 's1', 'api');
    expect(mgr.openTerminals().length).toBe(1);
    expect(mgr.activeId()).toBe('s1');
    expect(mgr.dockedTerminals().length).toBe(1);
  });

  it('open is idempotent and re-focuses existing terminal', () => {
    mgr.open('p1', 's1', 'api');
    mgr.open('p1', 's2', 'web');
    mgr.open('p1', 's1', 'api');
    expect(mgr.openTerminals().length).toBe(2);
    expect(mgr.activeId()).toBe('s1');
  });

  it('toggleSplit keeps at most two docked ids and toggles off', () => {
    mgr.open('p1', 's1', 'api');
    mgr.open('p1', 's2', 'web');
    mgr.open('p1', 's3', 'worker');
    mgr.toggleSplit('s1');
    mgr.toggleSplit('s2');
    mgr.toggleSplit('s3'); // third is ignored (max 2)
    expect(mgr.splitIds().length).toBe(2);
    mgr.toggleSplit('s1'); // removes s1
    expect(mgr.splitIds()).toEqual(['s2']);
  });

  it('float moves a terminal to floating and dock returns it', () => {
    mgr.open('p1', 's1', 'api');
    mgr.float('s1');
    expect(mgr.floatingTerminals().map(t => t.serviceId)).toEqual(['s1']);
    expect(mgr.dockedTerminals().length).toBe(0);
    mgr.dock('s1');
    expect(mgr.dockedTerminals().length).toBe(1);
    expect(mgr.floatingTerminals().length).toBe(0);
  });

  it('close removes the terminal and clears active/split references', () => {
    mgr.open('p1', 's1', 'api');
    mgr.open('p1', 's2', 'web');
    mgr.toggleSplit('s1'); mgr.toggleSplit('s2');
    mgr.close('s1');
    expect(mgr.openTerminals().map(t => t.serviceId)).toEqual(['s2']);
    expect(mgr.splitIds()).toEqual(['s2']);
    expect(mgr.activeId()).toBe('s2');
  });
});
