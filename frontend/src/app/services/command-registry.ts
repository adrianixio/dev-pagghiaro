import { Command } from './command-palette.service';
import { UiProject } from '../models/project.model';

export interface CommandDeps {
  projects: () => UiProject[];
  activeProject: () => UiProject | null;
  setActiveProject: (id: string) => void;
  startService: (p: string, s: string) => void;
  stopService: (p: string, s: string) => void;
  restartService: (p: string, s: string) => void;
  killServicePort: (p: string, s: string) => void;
  startAllServices: (p: string) => void;
  stopAllServices: (p: string) => void;
  restartAllServices: (p: string) => void;
  reloadProjectContext: (p: string) => void;
  openTerminal: (p: string, s: string, name: string) => void;
  toggleDarkMode: () => void;
  openNewProject: () => void;
  openConfig: (projectId: string) => void;
  openLogs: (projectId: string) => void;
}

export function buildCommands(d: CommandDeps): Command[] {
  const cmds: Command[] = [];
  for (const project of d.projects()) {
    cmds.push({ id: `switch:${project.id}`, title: `Switch to ${project.name}`, icon: 'folder', action: () => d.setActiveProject(project.id) });
    cmds.push({ id: `edit:${project.id}`, title: `Edit ${project.name} settings`, icon: 'settings', action: () => d.openConfig(project.id) });
  }
  const active = d.activeProject();
  if (active) {
    cmds.push(
      { id: 'start-all', title: 'Start all services', icon: 'play', action: () => d.startAllServices(active.id) },
      { id: 'stop-all', title: 'Stop all services', icon: 'square', action: () => d.stopAllServices(active.id) },
      { id: 'restart-all', title: 'Restart all services', icon: 'refresh-cw', action: () => d.restartAllServices(active.id) },
      { id: 'reload-context', title: 'Reload project context', icon: 'rotate-cw', action: () => d.reloadProjectContext(active.id) },
      { id: 'open-logs', title: 'Open logs', icon: 'scroll-text', action: () => d.openLogs(active.id) },
    );
    for (const s of active.services) {
      cmds.push(
        { id: `start:${s.id}`, title: `Start ${s.name}`, icon: 'play', action: () => d.startService(active.id, s.id) },
        { id: `stop:${s.id}`, title: `Stop ${s.name}`, icon: 'square', action: () => d.stopService(active.id, s.id) },
        { id: `restart:${s.id}`, title: `Restart ${s.name}`, icon: 'refresh-cw', action: () => d.restartService(active.id, s.id) },
        { id: `terminal:${s.id}`, title: `Open terminal: ${s.name}`, icon: 'terminal', action: () => d.openTerminal(active.id, s.id, s.name) },
        { id: `killport:${s.id}`, title: `Kill port: ${s.name}`, icon: 'plug-zap', action: () => d.killServicePort(active.id, s.id) },
      );
    }
  }
  cmds.push(
    { id: 'toggle-theme', title: 'Toggle light/dark theme', icon: 'moon', action: () => d.toggleDarkMode() },
    { id: 'new-project', title: 'New project', icon: 'folder-plus', action: () => d.openNewProject() },
  );
  return cmds;
}
