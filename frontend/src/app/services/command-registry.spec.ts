import { buildCommands } from './command-registry';

describe('buildCommands', () => {
  const project = { id: 'p1', name: 'demo', rootPath: '/x', services: [{ id: 's1', name: 'api', status: 'running' }] } as any;
  const deps: any = {
    projects: () => [project],
    activeProject: () => project,
    setActiveProject: () => {},
    startService: () => {}, stopService: () => {}, restartService: () => {},
    killServicePort: () => {}, startAllServices: () => {}, stopAllServices: () => {},
    restartAllServices: () => {}, reloadProjectContext: () => {},
    openTerminal: () => {}, toggleDarkMode: () => {}, openNewProject: () => {},
  };

  it('includes a switch command per project and actions per service', () => {
    const cmds = buildCommands(deps);
    expect(cmds.some((c) => c.title.includes('demo'))).toBeTrue();
    expect(cmds.some((c) => c.id === 'start:s1')).toBeTrue();
    expect(cmds.some((c) => c.id === 'terminal:s1')).toBeTrue();
    expect(cmds.some((c) => c.id === 'toggle-theme')).toBeTrue();
  });
});
