# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the DevPagghiaro frontend as an "IDE Workbench" layout with a refined rustic ("Casale") design system, a dense service list, and a hybrid terminal system (tabbed + split + floating), on the existing Angular 18 + Tailwind stack.

**Architecture:** A shared design system (Tailwind tokens + small standalone `ui/` primitives) underpins a new `layout/` shell (icon rail, sidebar, toolbar), a `dashboard/` dense service list with expandable rows, and a `terminal/` subsystem driven by a `TerminalManager` service that tracks each open terminal's mode (docked tab, split, or floating CDK window). All domain data still flows through the existing services (`ProjectService`, WS logs); the redesign is presentation + client-side UI state only.

**Tech Stack:** Angular 18 (standalone components, signals), Tailwind 3 (darkMode: 'class'), `@xterm/xterm` + `@xterm/addon-fit`, `@angular/cdk` (Drag/Overlay), `lucide-angular`. Tests: `ng test` (Karma + Jasmine).

## Global Constraints

- Angular 18 **standalone** components with **signals**; no NgModules. Match existing style.
- Tailwind 3 with `darkMode: 'class'`; dark mode toggled by adding/removing `dark` on `document.documentElement` (already done in `UiService`).
- **No new runtime state/framework dependencies.** Only already-present libraries: `@angular/cdk`, `@xterm/xterm`, `@xterm/addon-fit`, `lucide-angular`, `rxjs`. Self-hosted font packages (`@fontsource/*`) are permitted as build assets (NOT an external CDN).
- **No external CDN** for fonts or assets at runtime.
- Keep existing service public APIs working: `ProjectService`, `CommandPaletteService`, `AppMetadataService`. `TerminalService` and `UiService` may be extended (not broken).
- Existing shared types come from `@dev-pagghiaro/shared`: `ServiceStatus = 'stopped' | 'running' | 'error' | 'restarting'`. UI models in `src/app/models/project.model.ts`: `UiProject`, `UiService` (extends `ServiceConfig` with `status: ServiceStatus; metrics?: {cpu:number; ram:number}`), `LogMessage`.
- Accent color = country-green `#719337`; danger = country-red; warning = country-yellow; info = country-blue. Headings use Bitter serif; body Source Sans 3; mono JetBrains Mono.
- localStorage keys are namespaced `dev-pagghiaro-*` (existing: `dev-pagghiaro-theme`).
- Every UI state that must persist (theme, terminal panel height, floating window geometry) persists to `localStorage`, never to the backend.
- Run all frontend commands from `frontend/`. Test command: `ng test --watch=false --browsers=ChromeHeadless`. Build check: `ng build`.

---

## File Structure

**New:**
- `frontend/src/app/ui/` — `ui-button.component.ts`, `ui-icon-button.component.ts`, `ui-status-dot.component.ts`, `ui-badge.component.ts`, `ui-panel.component.ts` (+ `.spec.ts` where noted).
- `frontend/src/app/layout/` — `app-shell.component.ts`, `icon-rail.component.ts`, `sidebar.component.ts`, `toolbar.component.ts`.
- `frontend/src/app/dashboard/` — `service-list.component.ts`, `service-row.component.ts`, `service-detail.component.ts`, `execution-plan.component.ts`, `empty-state.component.ts`.
- `frontend/src/app/terminal/` — `terminal-manager.service.ts` (+ `.spec.ts`), `terminal-panel.component.ts`, `terminal-tab.component.ts`, `terminal-view.component.ts`, `floating-terminal.component.ts`.

**Modified:**
- `frontend/tailwind.config.js` — refined tokens.
- `frontend/src/styles.css` — fonts + base.
- `frontend/src/app/app.component.ts` — reduced to hosting `<app-shell>`.
- `frontend/src/app/services/ui.service.ts` — add layout state (panel height).
- `frontend/src/app/services/command-palette.service.ts` — unchanged API; new command sources registered by a helper.
- `frontend/package.json` — `@fontsource/*` dev assets + `test` already present via `ng test`.

**Removed (at the end, Task 13):** old `components/dashboard`, `components/sidebar`, `components/service-card`, `components/terminal`, old `app.component` template internals — replaced by the new folders.

---

## Task 1: Design system — Tailwind tokens, fonts, base styles

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/package.json` (add font packages)

**Interfaces:**
- Produces: Tailwind semantic utility classes and CSS variables consumed by every later task. Font families `font-display` (Bitter), `font-sans` (Source Sans 3), `font-mono` (JetBrains Mono).

- [ ] **Step 1: Install self-hosted font packages**

Run (from `frontend/`):
```bash
bun add -D @fontsource/bitter @fontsource-variable/source-sans-3 @fontsource-variable/jetbrains-mono
```
Expected: packages added to `devDependencies`.

- [ ] **Step 2: Import fonts and base tokens in `src/styles.css`**

Replace the top of `frontend/src/styles.css` (keep any existing xterm import lines below) with:
```css
@import '@fontsource/bitter/600.css';
@import '@fontsource/bitter/700.css';
@import '@fontsource-variable/source-sans-3';
@import '@fontsource-variable/jetbrains-mono';

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}
:root.dark {
  color-scheme: dark;
}

@layer base {
  body {
    @apply bg-surface text-content font-sans antialiased;
  }
  h1, h2, h3, .font-display {
    @apply font-display;
  }
}
```
Keep the existing `@import '@xterm/xterm/css/xterm.css';` (or equivalent) if present; otherwise add it below the font imports.

- [ ] **Step 3: Add semantic tokens to `tailwind.config.js`**

In `frontend/tailwind.config.js`, extend `theme.extend.colors` (keep existing `rustic` and `country` scales) by adding semantic aliases, and confirm `fontFamily` matches. Replace the `theme.extend` block with:
```js
    extend: {
      colors: {
        rustic: {
          950: '#120d0c', 900: '#1a1412', 800: '#261d19', 700: '#3f312b',
          600: '#5d4a41', 500: '#8c7364', 400: '#ad907e', 300: '#cead98',
          200: '#e6ccb8', 100: '#f4e4d8', 50: '#faf5f0',
        },
        country: {
          green: '#719337', blue: '#4c8cc0', pink: '#e6789c',
          yellow: '#ebb223', red: '#b40303',
        },
        // Semantic aliases (light value; dark handled via `dark:` utilities in components)
        surface: '#faf5f0',
        'surface-raised': '#ffffff',
        border: '#e6ccb8',
        content: '#1a1412',
        'content-muted': '#8c7364',
        accent: '#719337',
        danger: '#b40303',
        warning: '#ebb223',
        info: '#4c8cc0',
      },
      fontFamily: {
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'Consolas', 'Monaco', 'monospace'],
        sans: ['"Source Sans 3 Variable"', '"Source Sans 3"', '"Trebuchet MS"', 'sans-serif'],
        display: ['"Bitter"', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(63,49,43,.06), 0 1px 3px rgba(63,49,43,.05)',
        float: '0 8px 24px rgba(18,13,12,.28)',
      },
    },
```

- [ ] **Step 4: Verify the build compiles with the new tokens**

Run: `ng build`
Expected: build succeeds (exit 0). If `bg-surface`/`text-content` are unknown, the color tokens weren't picked up — recheck Step 3.

- [ ] **Step 5: Commit**
```bash
git add frontend/tailwind.config.js frontend/src/styles.css frontend/package.json frontend/bun.lock
git commit -m "feat(ui): add Casale design tokens and self-hosted fonts"
```

---

## Task 2: UI primitives (`ui/`)

**Files:**
- Create: `frontend/src/app/ui/ui-status-dot.component.ts`
- Create: `frontend/src/app/ui/ui-button.component.ts`
- Create: `frontend/src/app/ui/ui-icon-button.component.ts`
- Create: `frontend/src/app/ui/ui-badge.component.ts`
- Create: `frontend/src/app/ui/ui-panel.component.ts`
- Create: `frontend/src/app/ui/ui-status-dot.component.spec.ts`
- Create: `frontend/src/app/ui/ui-button.component.spec.ts`

**Interfaces:**
- Produces:
  - `<ui-status-dot [status]="ServiceStatus" />`
  - `<ui-button [variant]="'primary'|'secondary'|'ghost'|'danger'" [size]="'sm'|'md'" [disabled]="boolean" (click)>` (content-projected label)
  - `<ui-icon-button [icon]="string" [label]="string" [tone]="'default'|'accent'|'danger'|'warning'|'info'" (click)>`
  - `<ui-badge [tone]="'neutral'|'accent'|'danger'|'muted'">` (content-projected)
  - `<ui-panel [title]="string?">` (content-projected body; optional `header` slot)

- [ ] **Step 1: Write the failing test for status dot and button**

Create `frontend/src/app/ui/ui-status-dot.component.spec.ts`:
```ts
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
```

Create `frontend/src/app/ui/ui-button.component.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot find modules `./ui-status-dot.component` / `./ui-button.component`.

- [ ] **Step 3: Implement the primitives**

Create `frontend/src/app/ui/ui-status-dot.component.ts`:
```ts
import { Component, Input, computed, signal } from '@angular/core';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'ui-status-dot',
  standalone: true,
  template: `<span class="inline-block h-2.5 w-2.5 rounded-full" [class]="cls()"></span>`,
})
export class UiStatusDotComponent {
  private readonly status$ = signal<ServiceStatus>('stopped');
  @Input() set status(value: ServiceStatus) { this.status$.set(value); }
  readonly cls = computed(() => {
    switch (this.status$()) {
      case 'running': return 'bg-accent';
      case 'error': return 'bg-danger';
      case 'restarting': return 'bg-warning animate-pulse';
      default: return 'bg-content-muted';
    }
  });
}
```

Create `frontend/src/app/ui/ui-button.component.ts`:
```ts
import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-button',
  standalone: true,
  template: `
    <button type="button" [disabled]="disabled" [class]="classes">
      <ng-content></ng-content>
    </button>
  `,
})
export class UiButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary';
  @Input() size: 'sm' | 'md' = 'md';
  @Input() disabled = false;

  get classes(): string {
    const base = 'inline-flex items-center gap-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
    const variants = {
      primary: 'bg-accent text-white hover:bg-accent/90',
      secondary: 'bg-surface-raised text-content-muted border border-border hover:bg-rustic-100 dark:bg-rustic-800 dark:text-rustic-200 dark:border-rustic-700 dark:hover:bg-rustic-700',
      ghost: 'text-content-muted hover:bg-rustic-100 dark:text-rustic-300 dark:hover:bg-rustic-800',
      danger: 'bg-danger text-white hover:bg-danger/90',
    };
    return `${base} ${sizes[this.size]} ${variants[this.variant]}`;
  }
}
```

Create `frontend/src/app/ui/ui-icon-button.component.ts`:
```ts
import { Component, Input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'ui-icon-button',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button type="button" [attr.aria-label]="label" [attr.title]="label" [class]="classes">
      <lucide-icon [name]="icon" [size]="size"></lucide-icon>
    </button>
  `,
})
export class UiIconButtonComponent {
  @Input() icon = 'circle';
  @Input() label = '';
  @Input() size = 16;
  @Input() tone: 'default' | 'accent' | 'danger' | 'warning' | 'info' = 'default';

  get classes(): string {
    const base = 'inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-rustic-100 dark:hover:bg-rustic-800';
    const tones = {
      default: 'text-content-muted hover:text-content dark:hover:text-rustic-100',
      accent: 'text-content-muted hover:text-accent',
      danger: 'text-content-muted hover:text-danger',
      warning: 'text-content-muted hover:text-warning',
      info: 'text-content-muted hover:text-info',
    };
    return `${base} ${tones[this.tone]}`;
  }
}
```

Create `frontend/src/app/ui/ui-badge.component.ts`:
```ts
import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-badge',
  standalone: true,
  template: `<span [class]="classes"><ng-content></ng-content></span>`,
})
export class UiBadgeComponent {
  @Input() tone: 'neutral' | 'accent' | 'danger' | 'muted' = 'neutral';
  get classes(): string {
    const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono';
    const tones = {
      neutral: 'bg-rustic-100 text-content-muted border border-border dark:bg-rustic-800 dark:text-rustic-300 dark:border-rustic-700',
      accent: 'bg-accent/15 text-accent border border-accent/30',
      danger: 'bg-danger/12 text-danger border border-danger/30',
      muted: 'bg-rustic-100 text-content-muted dark:bg-rustic-800 dark:text-rustic-400',
    };
    return `${base} ${tones[this.tone]}`;
  }
}
```

Create `frontend/src/app/ui/ui-panel.component.ts`:
```ts
import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-panel',
  standalone: true,
  template: `
    <section class="rounded-lg border border-border bg-surface-raised shadow-soft transition-colors dark:border-rustic-700 dark:bg-rustic-800">
      @if (title) {
        <header class="border-b border-border px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-content dark:border-rustic-700 dark:text-rustic-100">
          {{ title }}
        </header>
      }
      <div class="p-4"><ng-content></ng-content></div>
    </section>
  `,
})
export class UiPanelComponent {
  @Input() title?: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (status-dot + button specs green).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/ui
git commit -m "feat(ui): add design-system primitives (button, icon-button, status-dot, badge, panel)"
```

---

## Task 3: Extend `UiService` with layout state

**Files:**
- Modify: `frontend/src/app/services/ui.service.ts`
- Create: `frontend/src/app/services/ui.service.spec.ts`

**Interfaces:**
- Consumes: existing `UiService` (theme, sidebar, mobile, toast, config).
- Produces on `UiService`: `terminalPanelHeight: Signal<number>`, `setTerminalPanelHeight(px: number): void` (clamped 120–800, persisted to `localStorage` key `dev-pagghiaro-panel-height`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/services/ui.service.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `setTerminalPanelHeight` is not a function.

- [ ] **Step 3: Implement panel-height state in `UiService`**

In `frontend/src/app/services/ui.service.ts`, add inside the class (near the other signals):
```ts
  private readonly terminalPanelHeightSignal = signal<number>(this.getInitialPanelHeight());
  readonly terminalPanelHeight = this.terminalPanelHeightSignal.asReadonly();
```
Add these methods to the class:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/services/ui.service.ts frontend/src/app/services/ui.service.spec.ts
git commit -m "feat(ui): add terminal panel height state to UiService"
```

---

## Task 4: `TerminalManager` service (terminal modes)

**Files:**
- Create: `frontend/src/app/terminal/terminal-manager.service.ts`
- Create: `frontend/src/app/terminal/terminal-manager.service.spec.ts`

**Interfaces:**
- Consumes: existing `TerminalService` (`toggleTerminal`, `closeTerminal`, `sendInput`, `sendResize`, `clearTerminal`, `logs$`). `ProjectService` for names.
- Produces: `TerminalManager` with:
  - `openTerminals: Signal<OpenTerminal[]>` where `OpenTerminal = { serviceId: string; projectId: string; serviceName: string; mode: 'docked' | 'floating'; float: { x: number; y: number; width: number; height: number; maximized: boolean } }`
  - `activeId: Signal<string | null>` (active docked tab)
  - `splitIds: Signal<string[]>` (0–2 docked ids shown side by side; empty = single active tab)
  - `open(projectId, serviceId, serviceName)`, `close(serviceId)`, `activate(serviceId)`, `toggleSplit(serviceId)`, `float(serviceId)`, `dock(serviceId)`, `toggleMaximize(serviceId)`, `setFloatGeometry(serviceId, geo)`, `bringToFront(serviceId)`
  - `dockedTerminals: Signal<OpenTerminal[]>`, `floatingTerminals: Signal<OpenTerminal[]>` (computed)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/terminal/terminal-manager.service.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot find `./terminal-manager.service`.

- [ ] **Step 3: Implement `TerminalManager`**

Create `frontend/src/app/terminal/terminal-manager.service.ts`:
```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { TerminalService } from '../services/terminal.service';

export interface FloatGeometry {
  x: number; y: number; width: number; height: number; maximized: boolean;
}
export interface OpenTerminal {
  serviceId: string;
  projectId: string;
  serviceName: string;
  mode: 'docked' | 'floating';
  float: FloatGeometry;
}

const DEFAULT_FLOAT: FloatGeometry = { x: 80, y: 80, width: 520, height: 320, maximized: false };
const FLOAT_KEY = 'dev-pagghiaro-floats';

@Injectable({ providedIn: 'root' })
export class TerminalManager {
  private readonly terminalService = inject(TerminalService);

  private readonly terminals = signal<OpenTerminal[]>([]);
  private readonly activeIdSignal = signal<string | null>(null);
  private readonly splitIdsSignal = signal<string[]>([]);
  private zCounter = 0;

  readonly openTerminals = this.terminals.asReadonly();
  readonly activeId = this.activeIdSignal.asReadonly();
  readonly splitIds = this.splitIdsSignal.asReadonly();
  readonly dockedTerminals = computed(() => this.terminals().filter((t) => t.mode === 'docked'));
  readonly floatingTerminals = computed(() => this.terminals().filter((t) => t.mode === 'floating'));

  open(projectId: string, serviceId: string, serviceName: string): void {
    const existing = this.terminals().find((t) => t.serviceId === serviceId);
    if (existing) {
      if (existing.mode === 'docked') this.activeIdSignal.set(serviceId);
      return;
    }
    this.terminalService.toggleTerminal(projectId, serviceId, serviceName); // opens WS
    this.terminals.update((list) => [
      ...list,
      { serviceId, projectId, serviceName, mode: 'docked', float: this.loadFloat(serviceId) },
    ]);
    this.activeIdSignal.set(serviceId);
  }

  close(serviceId: string): void {
    this.terminalService.closeTerminal(serviceId);
    this.terminals.update((list) => list.filter((t) => t.serviceId !== serviceId));
    this.splitIdsSignal.update((ids) => ids.filter((id) => id !== serviceId));
    if (this.activeIdSignal() === serviceId) {
      this.activeIdSignal.set(this.dockedTerminals()[0]?.serviceId ?? null);
    }
  }

  activate(serviceId: string): void {
    if (this.terminals().some((t) => t.serviceId === serviceId && t.mode === 'docked')) {
      this.activeIdSignal.set(serviceId);
    }
  }

  toggleSplit(serviceId: string): void {
    const term = this.terminals().find((t) => t.serviceId === serviceId);
    if (!term || term.mode !== 'docked') return;
    const ids = this.splitIdsSignal();
    if (ids.includes(serviceId)) {
      this.splitIdsSignal.set(ids.filter((id) => id !== serviceId));
      return;
    }
    if (ids.length >= 2) return; // max two side by side
    this.splitIdsSignal.set([...ids, serviceId]);
  }

  float(serviceId: string): void {
    this.setMode(serviceId, 'floating');
    this.splitIdsSignal.update((ids) => ids.filter((id) => id !== serviceId));
    if (this.activeIdSignal() === serviceId) {
      this.activeIdSignal.set(this.dockedTerminals()[0]?.serviceId ?? null);
    }
    this.bringToFront(serviceId);
  }

  dock(serviceId: string): void {
    this.setMode(serviceId, 'docked');
    this.activeIdSignal.set(serviceId);
  }

  toggleMaximize(serviceId: string): void {
    this.updateFloat(serviceId, (g) => ({ ...g, maximized: !g.maximized }));
  }

  setFloatGeometry(serviceId: string, geo: Partial<FloatGeometry>): void {
    this.updateFloat(serviceId, (g) => ({ ...g, ...geo }));
    this.persistFloats();
  }

  bringToFront(serviceId: string): void {
    this.zCounter += 1;
    (this as unknown as { _z?: Record<string, number> });
    this.zIndexMap[serviceId] = this.zCounter;
  }

  readonly zIndexMap: Record<string, number> = {};

  private setMode(serviceId: string, mode: OpenTerminal['mode']): void {
    this.terminals.update((list) =>
      list.map((t) => (t.serviceId === serviceId ? { ...t, mode } : t))
    );
  }

  private updateFloat(serviceId: string, fn: (g: FloatGeometry) => FloatGeometry): void {
    this.terminals.update((list) =>
      list.map((t) => (t.serviceId === serviceId ? { ...t, float: fn(t.float) } : t))
    );
  }

  private loadFloat(serviceId: string): FloatGeometry {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_FLOAT };
    try {
      const all = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? '{}') as Record<string, FloatGeometry>;
      return all[serviceId] ?? { ...DEFAULT_FLOAT };
    } catch {
      return { ...DEFAULT_FLOAT };
    }
  }

  private persistFloats(): void {
    if (typeof localStorage === 'undefined') return;
    const map: Record<string, FloatGeometry> = {};
    for (const t of this.terminals()) map[t.serviceId] = t.float;
    localStorage.setItem(FLOAT_KEY, JSON.stringify(map));
  }
}
```
Note: remove the stray line `(this as unknown as { _z?: Record<string, number> });` if your linter flags it — it is a no-op; the `zIndexMap` field is the real state. (Kept minimal deliberately; z-order is a plain map keyed by serviceId.)

- [ ] **Step 4: Run test to verify it passes**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (all 5 TerminalManager specs green).

- [ ] **Step 5: Clean up the no-op line**

Edit `terminal-manager.service.ts`: delete the line `(this as unknown as { _z?: Record<string, number> });` inside `bringToFront`. Re-run the test — still PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/app/terminal/terminal-manager.service.ts frontend/src/app/terminal/terminal-manager.service.spec.ts
git commit -m "feat(terminal): add TerminalManager with docked/split/floating modes"
```

---

## Task 5: `terminal-view` (xterm wrapper) + `terminal-tab`

**Files:**
- Create: `frontend/src/app/terminal/terminal-view.component.ts`
- Create: `frontend/src/app/terminal/terminal-tab.component.ts`

**Interfaces:**
- Consumes: `TerminalService` (`logs$`, `sendInput`, `sendResize`, `clearTerminal`), `UiService` (`darkMode`), `OpenTerminal` from `TerminalManager`.
- Produces:
  - `<app-terminal-view [terminal]="OpenTerminal" />` — a self-contained xterm instance for one service; re-fits on container resize.
  - `<app-terminal-tab [terminal]="OpenTerminal" [active]="boolean" (select) (close) />`

- [ ] **Step 1: Implement `terminal-view` (port of existing xterm logic)**

Create `frontend/src/app/terminal/terminal-view.component.ts` by adapting the existing `components/terminal/terminal.component.ts` xterm logic to take an `OpenTerminal` and render only the xterm surface (no header — headers live in panel/floating). Use the same `LIGHT_TERMINAL_THEME` / `DARK_TERMINAL_THEME` constants (copy them verbatim from the existing file), the same `initTerminal`, `logs$` subscription filtered by `terminal.serviceId`/`terminal.projectId`, `onData`→`sendInput`, `onResize`→`sendResize`, and a `ResizeObserver` calling `fitAddon.fit()` + `sendResize`. Template:
```ts
  template: `<div #host class="absolute inset-0 p-2"></div>`,
  host: { class: 'relative block h-full w-full' },
```
Expose a public method `refit(): void { this.fitAddon?.fit(); if (this.terminal) this.terminalService.sendResize(this.terminal.cols ? ... ) }` — specifically:
```ts
  refit(): void {
    if (!this.fitAddon || !this.terminal) return;
    this.fitAddon.fit();
    this.terminalService.sendResize(this.terminal.cols, this.terminal.rows, /* see note */);
  }
```
Note: `sendResize(serviceId, cols, rows)` — call `this.terminalService.sendResize(this.terminal!.serviceId? )`. The service id comes from `this.terminal.serviceId`. Correct call: `this.terminalService.sendResize(this.terminalMeta.serviceId, this.terminal.cols, this.terminal.rows)` where `@Input({required:true}) terminal!: OpenTerminal;` is stored as `terminalMeta`. Keep the `@Input` named `terminal` and reference `this.terminal.serviceId` for the meta and a separate private `xterm` field for the `Terminal` instance to avoid the name clash. Rename the xterm instance field to `xterm` (not `terminal`) throughout to avoid colliding with the `@Input`.

Full component:
```ts
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, effect, inject } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Subscription } from 'rxjs';
import { TerminalService } from '../services/terminal.service';
import { UiService } from '../services/ui.service';
import { LogMessage } from '../models/project.model';
import { OpenTerminal } from './terminal-manager.service';

const LIGHT_TERMINAL_THEME = { /* copy verbatim from components/terminal/terminal.component.ts */ } as const;
const DARK_TERMINAL_THEME = { /* copy verbatim from components/terminal/terminal.component.ts */ } as const;

@Component({
  selector: 'app-terminal-view',
  standalone: true,
  host: { class: 'relative block h-full w-full' },
  template: `<div #host class="absolute inset-0 p-2"></div>`,
})
export class TerminalViewComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) terminal!: OpenTerminal;
  @ViewChild('host') host!: ElementRef<HTMLElement>;

  private readonly terminalService = inject(TerminalService);
  private readonly uiService = inject(UiService);
  private xterm?: Terminal;
  private fitAddon?: FitAddon;
  private logsSub?: Subscription;
  private resizeObserver?: ResizeObserver;
  private pending: LogMessage[] = [];

  constructor() {
    effect(() => {
      const theme = this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
      if (!this.xterm) return;
      this.xterm.options.theme = theme as any;
      this.fitAddon?.fit();
    });
  }

  ngOnInit(): void {
    this.logsSub = this.terminalService.logs$.subscribe((log) => {
      if (log.projectId !== this.terminal.projectId || log.serviceId !== this.terminal.serviceId) return;
      if (log.type === 'system' && log.data === '\x1b[2J\x1b[H') { this.xterm ? this.xterm.clear() : (this.pending = []); return; }
      this.xterm ? this.xterm.write(log.data) : this.pending.push(log);
    });
  }

  ngAfterViewInit(): void { this.init(); }

  refit(): void {
    if (!this.fitAddon || !this.xterm) return;
    this.fitAddon.fit();
    this.terminalService.sendResize(this.terminal.serviceId, this.xterm.cols, this.xterm.rows);
  }

  clear(): void { this.terminalService.clearTerminal(this.terminal.projectId, this.terminal.serviceId); }

  ngOnDestroy(): void {
    this.logsSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();
  }

  private init(): void {
    this.xterm = new Terminal({
      theme: (this.uiService.darkMode() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME) as any,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
      fontSize: 13, cursorBlink: true, convertEol: true, disableStdin: false,
    });
    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.open(this.host.nativeElement);
    this.fitAddon.fit();
    this.xterm.onData((data) => this.terminalService.sendInput(this.terminal.serviceId, data));
    this.xterm.onResize(({ cols, rows }) => this.terminalService.sendResize(this.terminal.serviceId, cols, rows));
    for (const log of this.pending) this.xterm.write(log.data);
    this.pending = [];
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.host.nativeElement);
  }
}
```

- [ ] **Step 2: Implement `terminal-tab`**

Create `frontend/src/app/terminal/terminal-tab.component.ts`:
```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { LucideAngularModule } from 'lucide-angular';
import { OpenTerminal } from './terminal-manager.service';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-terminal-tab',
  standalone: true,
  imports: [UiStatusDotComponent, LucideAngularModule],
  template: `
    <div (click)="select.emit()"
      class="group flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 text-sm cursor-pointer transition-colors"
      [class]="active
        ? 'bg-rustic-950 text-rustic-50 border-rustic-800'
        : 'bg-rustic-800 text-rustic-300 border-rustic-800 hover:bg-rustic-700'">
      <ui-status-dot [status]="status"></ui-status-dot>
      <span class="max-w-[10rem] truncate">{{ terminal.serviceName }}</span>
      <button type="button" (click)="$event.stopPropagation(); close.emit()"
        class="opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Close terminal">
        <lucide-icon name="x" [size]="13"></lucide-icon>
      </button>
    </div>
  `,
})
export class TerminalTabComponent {
  @Input({ required: true }) terminal!: OpenTerminal;
  @Input() active = false;
  @Input() status: ServiceStatus = 'running';
  @Output() select = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
}
```

- [ ] **Step 3: Verify build compiles**

Run: `ng build`
Expected: build succeeds. (Confirm the theme constants were copied verbatim; a missing constant is a compile error.)

- [ ] **Step 4: Commit**
```bash
git add frontend/src/app/terminal/terminal-view.component.ts frontend/src/app/terminal/terminal-tab.component.ts
git commit -m "feat(terminal): add terminal-view (xterm) and terminal-tab components"
```

---

## Task 6: `terminal-panel` (docked tabs + resize + split)

**Files:**
- Create: `frontend/src/app/terminal/terminal-panel.component.ts`

**Interfaces:**
- Consumes: `TerminalManager` (openTerminals/docked/active/split + operations), `UiService` (`terminalPanelHeight`, `setTerminalPanelHeight`), `ProjectService` (service status lookup), `TerminalViewComponent`, `TerminalTabComponent`, `UiIconButtonComponent`.
- Produces: `<app-terminal-panel />` — bottom docked panel; hidden when no docked terminals.

- [ ] **Step 1: Implement `terminal-panel`**

Create `frontend/src/app/terminal/terminal-panel.component.ts`:
```ts
import { Component, HostBinding, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TerminalManager } from './terminal-manager.service';
import { UiService } from '../services/ui.service';
import { ProjectService } from '../services/project.service';
import { TerminalTabComponent } from './terminal-tab.component';
import { TerminalViewComponent } from './terminal-view.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-terminal-panel',
  standalone: true,
  imports: [CommonModule, TerminalTabComponent, TerminalViewComponent, UiIconButtonComponent],
  template: `
    @if (mgr.dockedTerminals().length > 0) {
      <div class="flex flex-col border-t border-rustic-800 bg-rustic-950"
           [style.height.px]="maximized ? null : ui.terminalPanelHeight()"
           [class.flex-1]="maximized">
        <div class="relative h-1.5 cursor-row-resize bg-rustic-900 hover:bg-accent/40"
             (mousedown)="startResize($event)"></div>
        <div class="flex items-end justify-between gap-2 bg-rustic-900 px-2 pt-1">
          <div class="flex items-end gap-1 overflow-x-auto">
            @for (t of mgr.dockedTerminals(); track t.serviceId) {
              <app-terminal-tab [terminal]="t" [active]="mgr.activeId() === t.serviceId"
                [status]="statusOf(t.serviceId)"
                (select)="mgr.activate(t.serviceId)" (close)="mgr.close(t.serviceId)">
              </app-terminal-tab>
            }
          </div>
          <div class="flex items-center gap-1 pb-1">
            <ui-icon-button icon="columns-2" label="Split" (click)="splitActive()"></ui-icon-button>
            <ui-icon-button icon="external-link" label="Pop out" (click)="floatActive()"></ui-icon-button>
            <ui-icon-button [icon]="maximized ? 'minimize-2' : 'maximize-2'" label="Maximize" (click)="maximized = !maximized"></ui-icon-button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1">
          @for (t of visibleTerminals(); track t.serviceId) {
            <div class="min-w-0 flex-1 border-r border-rustic-800 last:border-r-0">
              <app-terminal-view [terminal]="t"></app-terminal-view>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class TerminalPanelComponent {
  readonly mgr = inject(TerminalManager);
  readonly ui = inject(UiService);
  private readonly projectService = inject(ProjectService);
  maximized = false;

  visibleTerminals() {
    const split = this.mgr.splitIds();
    const docked = this.mgr.dockedTerminals();
    if (split.length > 0) return docked.filter((t) => split.includes(t.serviceId));
    const active = docked.find((t) => t.serviceId === this.mgr.activeId());
    return active ? [active] : docked.slice(0, 1);
  }

  statusOf(serviceId: string): ServiceStatus {
    for (const p of this.projectService.projects()) {
      const s = p.services.find((svc) => svc.id === serviceId);
      if (s) return s.status;
    }
    return 'running';
  }

  splitActive() { const id = this.mgr.activeId(); if (id) this.mgr.toggleSplit(id); }
  floatActive() { const id = this.mgr.activeId(); if (id) this.mgr.float(id); }

  startResize(event: MouseEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startH = this.ui.terminalPanelHeight();
    const move = (e: MouseEvent) => this.ui.setTerminalPanelHeight(startH + (startY - e.clientY));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/terminal/terminal-panel.component.ts
git commit -m "feat(terminal): add docked terminal panel with tabs, resize, and split"
```

---

## Task 7: `floating-terminal` (CDK drag + resize)

**Files:**
- Create: `frontend/src/app/terminal/floating-terminal.component.ts`

**Interfaces:**
- Consumes: `@angular/cdk/drag-drop` (`CdkDrag`, `CdkDragEnd`), `TerminalManager`, `TerminalViewComponent`, `UiIconButtonComponent`, `UiStatusDotComponent`.
- Produces: `<app-floating-terminal [terminal]="OpenTerminal" [status]="ServiceStatus" />` — one draggable/resizable window.

- [ ] **Step 1: Implement `floating-terminal`**

Create `frontend/src/app/terminal/floating-terminal.component.ts`:
```ts
import { Component, ElementRef, Input, inject } from '@angular/core';
import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import { TerminalManager, OpenTerminal } from './terminal-manager.service';
import { TerminalViewComponent } from './terminal-view.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-floating-terminal',
  standalone: true,
  imports: [CdkDrag, TerminalViewComponent, UiIconButtonComponent, UiStatusDotComponent],
  template: `
    <div cdkDrag cdkDragBoundary=".shell-main" cdkDragHandle="false"
      (cdkDragEnded)="onDragEnd($event)" (mousedown)="mgr.bringToFront(terminal.serviceId)"
      class="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-rustic-700 bg-rustic-950 shadow-float"
      [style.left.px]="terminal.float.maximized ? 8 : terminal.float.x"
      [style.top.px]="terminal.float.maximized ? 8 : terminal.float.y"
      [style.width.px]="terminal.float.maximized ? null : terminal.float.width"
      [style.height.px]="terminal.float.maximized ? null : terminal.float.height"
      [class.inset-2]="terminal.float.maximized"
      [style.zIndex]="mgr.zIndexMap[terminal.serviceId] || 1">
      <div cdkDragHandle class="flex cursor-move items-center gap-2 bg-rustic-900 px-3 py-1.5 text-sm text-rustic-200">
        <ui-status-dot [status]="status"></ui-status-dot>
        <span class="truncate">{{ terminal.serviceName }}</span>
        <span class="ml-auto flex items-center gap-1">
          <ui-icon-button icon="pin" label="Dock" (click)="mgr.dock(terminal.serviceId)"></ui-icon-button>
          <ui-icon-button [icon]="terminal.float.maximized ? 'minimize-2' : 'maximize-2'" label="Maximize" (click)="mgr.toggleMaximize(terminal.serviceId)"></ui-icon-button>
          <ui-icon-button icon="x" label="Close" tone="danger" (click)="mgr.close(terminal.serviceId)"></ui-icon-button>
        </span>
      </div>
      <div class="relative min-h-0 flex-1">
        <app-terminal-view [terminal]="terminal"></app-terminal-view>
      </div>
      @if (!terminal.float.maximized) {
        <div class="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize" (mousedown)="startResize($event)"></div>
      }
    </div>
  `,
})
export class FloatingTerminalComponent {
  @Input({ required: true }) terminal!: OpenTerminal;
  @Input() status: ServiceStatus = 'running';
  readonly mgr = inject(TerminalManager);
  private readonly elRef = inject(ElementRef<HTMLElement>);

  onDragEnd(event: CdkDragEnd): void {
    const pos = event.source.getFreeDragPosition();
    this.mgr.setFloatGeometry(this.terminal.serviceId, {
      x: this.terminal.float.x + pos.x,
      y: this.terminal.float.y + pos.y,
    });
    event.source.reset();
  }

  startResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    const startW = this.terminal.float.width, startH = this.terminal.float.height;
    const move = (e: MouseEvent) => this.mgr.setFloatGeometry(this.terminal.serviceId, {
      width: Math.max(280, startW + (e.clientX - startX)),
      height: Math.max(180, startH + (e.clientY - startY)),
    });
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `ng build`
Expected: build succeeds (CdkDrag imported from `@angular/cdk/drag-drop`).

- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/terminal/floating-terminal.component.ts
git commit -m "feat(terminal): add draggable/resizable floating terminal window"
```

---

## Task 8: Dashboard — `service-row`, `service-detail`, `execution-plan`, `empty-state`

**Files:**
- Create: `frontend/src/app/dashboard/service-detail.component.ts`
- Create: `frontend/src/app/dashboard/service-row.component.ts`
- Create: `frontend/src/app/dashboard/execution-plan.component.ts`
- Create: `frontend/src/app/dashboard/empty-state.component.ts`
- Create: `frontend/src/app/dashboard/service-row.component.spec.ts`

**Interfaces:**
- Consumes: `UiService` model type, primitives, `LucideAngularModule`.
- Produces:
  - `<app-service-row [service]="UiService" [expanded]="boolean" (toggle) (start) (stop) (restart) (openTerminal) (killPort) />`
  - `<app-service-detail [service]="UiService" />`
  - `<app-execution-plan [planNames]="string[]" [excludedNames]="string[]" [delayMs]="number" />`
  - `<app-empty-state />`

- [ ] **Step 1: Write the failing test for `service-row`**

Create `frontend/src/app/dashboard/service-row.component.spec.ts`:
```ts
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ServiceRowComponent } from './service-row.component';
import { UiService } from '../models/project.model';

const svc: UiService = { id: 's1', name: 'api', command: 'bun run dev', cwd: '.', status: 'running', metrics: { cpu: 12, ram: 128 } } as any;

@Component({
  standalone: true, imports: [ServiceRowComponent],
  template: `<app-service-row [service]="svc" (start)="acted='start'" (openTerminal)="acted='term'"></app-service-row>`,
})
class Host { svc = svc; acted = ''; }

describe('ServiceRowComponent', () => {
  it('renders the service name and status, and emits actions', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('api');
    const openBtn = fixture.nativeElement.querySelector('[data-action="open-terminal"]') as HTMLButtonElement;
    openBtn.click();
    expect(fixture.componentInstance.acted).toBe('term');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot find `./service-row.component`.

- [ ] **Step 3: Implement `service-detail`**

Create `frontend/src/app/dashboard/service-detail.component.ts`:
```ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiService } from '../models/project.model';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  template: `
    <div class="grid gap-3 border-t border-border bg-surface px-4 py-3 text-sm dark:border-rustic-700 dark:bg-rustic-900 md:grid-cols-2">
      <div>
        <div class="mb-1 text-xs uppercase tracking-wider text-content-muted">Command</div>
        <code class="block break-all rounded bg-rustic-100 px-2 py-1 font-mono text-xs text-content dark:bg-rustic-800 dark:text-rustic-200">{{ service.command }}</code>
        <div class="mt-2 text-xs text-content-muted">cwd: <span class="font-mono">{{ service.cwd }}</span></div>
      </div>
      <div>
        <div class="mb-1 text-xs uppercase tracking-wider text-content-muted">Environment</div>
        @if (envEntries().length > 0) {
          <div class="flex flex-wrap gap-1">
            @for (e of envEntries(); track e[0]) { <ui-badge tone="muted">{{ e[0] }}</ui-badge> }
          </div>
        } @else {
          <div class="text-xs text-content-muted">No service-level env vars</div>
        }
        <div class="mt-2 flex gap-4 text-xs text-content-muted">
          <span>CPU <span class="font-mono text-content dark:text-rustic-200">{{ service.metrics?.cpu ?? 0 }}%</span></span>
          <span>MEM <span class="font-mono text-content dark:text-rustic-200">{{ (service.metrics?.ram ?? 0) | number:'1.0-0' }}MB</span></span>
        </div>
      </div>
    </div>
  `,
})
export class ServiceDetailComponent {
  @Input({ required: true }) service!: UiService;
  envEntries(): [string, string][] { return Object.entries(this.service.env ?? {}); }
}
```

- [ ] **Step 4: Implement `service-row`**

Create `frontend/src/app/dashboard/service-row.component.ts`:
```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { ServiceDetailComponent } from './service-detail.component';
import { UiService } from '../models/project.model';

@Component({
  selector: 'app-service-row',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiStatusDotComponent, UiBadgeComponent, UiIconButtonComponent, ServiceDetailComponent],
  template: `
    <div class="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-soft transition-colors dark:border-rustic-700 dark:bg-rustic-800">
      <div class="flex items-center gap-3 px-4 py-2.5">
        <button type="button" (click)="toggle.emit()" class="text-content-muted hover:text-content" [attr.aria-expanded]="expanded" aria-label="Toggle details">
          <lucide-icon [name]="expanded ? 'chevron-down' : 'chevron-right'" [size]="16"></lucide-icon>
        </button>
        <ui-status-dot [status]="service.status"></ui-status-dot>
        <span class="font-display font-bold text-content dark:text-rustic-100">{{ service.name }}</span>
        <code class="hidden min-w-0 flex-1 truncate font-mono text-xs text-content-muted md:block">{{ service.command }}</code>
        @if (service.port != null) { <ui-badge tone="neutral">:{{ service.port }}</ui-badge> }
        <div class="flex w-24 items-center gap-1 text-xs text-content-muted">
          <span class="inline-block h-3 w-10 rounded bg-gradient-to-r from-accent/20 to-accent/60"></span>
          <span class="font-mono">{{ service.metrics?.cpu ?? 0 }}%</span>
        </div>
        <div class="flex items-center gap-0.5">
          <ui-icon-button icon="play" label="Start" tone="accent" (click)="start.emit()"></ui-icon-button>
          <ui-icon-button icon="rotate-cw" label="Restart" tone="warning" (click)="restart.emit()"></ui-icon-button>
          <ui-icon-button icon="square" label="Stop" tone="danger" (click)="stop.emit()"></ui-icon-button>
          <span data-action="open-terminal" class="contents"><ui-icon-button icon="terminal" label="Open terminal" tone="info" (click)="openTerminal.emit()"></ui-icon-button></span>
          <ui-icon-button icon="plug-zap" label="Kill port" (click)="killPort.emit()"></ui-icon-button>
        </div>
      </div>
      @if (expanded) { <app-service-detail [service]="service"></app-service-detail> }
    </div>
  `,
})
export class ServiceRowComponent {
  @Input({ required: true }) service!: UiService;
  @Input() expanded = false;
  @Output() toggle = new EventEmitter<void>();
  @Output() start = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() openTerminal = new EventEmitter<void>();
  @Output() killPort = new EventEmitter<void>();
}
```
Note: the `data-action="open-terminal"` wrapper exists so the spec can target the button; `class="contents"` keeps layout unchanged. The spec clicks the `<button>` inside it — adjust the selector to `[data-action="open-terminal"] button` if needed. Update the spec's selector accordingly in Step 1 if the click doesn't register (use `querySelector('[data-action="open-terminal"] button')`).

- [ ] **Step 5: Implement `execution-plan` and `empty-state`**

Create `frontend/src/app/dashboard/execution-plan.component.ts`:
```ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { UiBadgeComponent } from '../ui/ui-badge.component';

@Component({
  selector: 'app-execution-plan',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiBadgeComponent],
  template: `
    @if (planNames.length > 0) {
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-bold uppercase tracking-wider text-content-muted">Plan</span>
        @for (name of planNames; track $index; let i = $index; let last = $last) {
          <span class="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-content dark:border-rustic-600 dark:bg-rustic-900 dark:text-rustic-200">
            <span class="font-semibold text-accent">{{ i + 1 }}</span>{{ name }}
          </span>
          @if (!last) { <lucide-icon name="arrow-right" [size]="12" class="text-content-muted"></lucide-icon> }
        }
        @if (delayMs > 0) { <ui-badge tone="muted">{{ delayMs }}ms</ui-badge> }
        @if (excludedNames.length > 0) { <ui-badge tone="muted">+{{ excludedNames.length }} excluded</ui-badge> }
      </div>
    }
  `,
})
export class ExecutionPlanComponent {
  @Input() planNames: string[] = [];
  @Input() excludedNames: string[] = [];
  @Input() delayMs = 0;
}
```

Create `frontend/src/app/dashboard/empty-state.component.ts`:
```ts
import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-1 flex-col items-center justify-center text-content-muted">
      <lucide-icon name="server" [size]="56" class="mb-4 opacity-50"></lucide-icon>
      <h2 class="font-display text-2xl font-bold text-content dark:text-rustic-200">No project selected</h2>
      <p class="mt-2 max-w-md text-center text-sm">Pick a project in the sidebar, or press
        <kbd class="rounded bg-rustic-200 px-2 py-0.5 font-mono text-xs text-accent dark:bg-rustic-700">Ctrl+K</kbd>
        to search projects and run commands.</p>
    </div>
  `,
})
export class EmptyStateComponent {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (service-row spec green; fix the selector to `[data-action="open-terminal"] button` if the click didn't register).

- [ ] **Step 7: Commit**
```bash
git add frontend/src/app/dashboard
git commit -m "feat(dashboard): add dense service row, detail, execution plan, empty state"
```

---

## Task 9: `service-list` (dashboard container)

**Files:**
- Create: `frontend/src/app/dashboard/service-list.component.ts`

**Interfaces:**
- Consumes: `ProjectService` (activeProject/activeServices + actions), `TerminalManager.open`, `UiService.showToast`, `ServiceRowComponent`, `ExecutionPlanComponent`, `EmptyStateComponent`.
- Produces: `<app-service-list />` — the main dashboard content.

- [ ] **Step 1: Implement `service-list`**

Create `frontend/src/app/dashboard/service-list.component.ts`:
```ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../services/project.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { UiService } from '../services/ui.service';
import { ServiceRowComponent } from './service-row.component';
import { ExecutionPlanComponent } from './execution-plan.component';
import { EmptyStateComponent } from './empty-state.component';
import { UiProject, UiService as UiServiceModel } from '../models/project.model';

@Component({
  selector: 'app-service-list',
  standalone: true,
  imports: [CommonModule, ServiceRowComponent, ExecutionPlanComponent, EmptyStateComponent],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    @if (projectService.activeProject(); as project) {
      <div class="border-b border-border px-6 py-3 dark:border-rustic-700">
        <app-execution-plan [planNames]="planNames(project)" [excludedNames]="excludedNames(project)"
          [delayMs]="project.executionOrder?.delayMs || 0"></app-execution-plan>
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4">
        @for (service of projectService.activeServices(); track service.id) {
          <app-service-row [service]="service" [expanded]="expandedId() === service.id"
            (toggle)="toggleExpand(service.id)"
            (start)="projectService.startService(project.id, service.id)"
            (stop)="projectService.stopService(project.id, service.id)"
            (restart)="projectService.restartService(project.id, service.id)"
            (openTerminal)="mgr.open(project.id, service.id, service.name)"
            (killPort)="killPort(project.id, service)">
          </app-service-row>
        }
      </div>
    } @else {
      <app-empty-state></app-empty-state>
    }
  `,
})
export class ServiceListComponent {
  readonly projectService = inject(ProjectService);
  readonly mgr = inject(TerminalManager);
  private readonly ui = inject(UiService);
  private readonly expandedIdSignal = signal<string | null>(null);
  readonly expandedId = this.expandedIdSignal.asReadonly();

  toggleExpand(id: string): void {
    this.expandedIdSignal.update((cur) => (cur === id ? null : id));
  }

  planNames(project: UiProject): string[] {
    const ids = project.executionOrder?.serviceIds ?? project.services.map((s) => s.id);
    return ids.map((id) => project.services.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
  }

  excludedNames(project: UiProject): string[] {
    const included = new Set(project.executionOrder?.serviceIds ?? project.services.map((s) => s.id));
    return project.services.filter((s) => !included.has(s.id)).map((s) => s.name);
  }

  async killPort(projectId: string, service: UiServiceModel): Promise<void> {
    if (service.port == null) { this.ui.showToast('No port', `${service.name} has no configured port`, 'error'); return; }
    const result = await this.projectService.killServicePort(projectId, service.id);
    if (result && result.killed.length > 0) {
      this.ui.showToast('Port freed', `Stopped PID ${result.killed.join(', ')} on :${service.port}`);
    } else {
      this.ui.showToast('Nothing to kill', `No process was listening on :${service.port}`);
    }
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/dashboard/service-list.component.ts
git commit -m "feat(dashboard): add service-list container wired to project actions"
```

---

## Task 10: Layout — `icon-rail`, `sidebar`, `toolbar`

**Files:**
- Create: `frontend/src/app/layout/icon-rail.component.ts`
- Create: `frontend/src/app/layout/sidebar.component.ts`
- Create: `frontend/src/app/layout/toolbar.component.ts`

**Interfaces:**
- Consumes: `ProjectService`, `UiService`, `CommandPaletteService`, `AppMetadataService`, primitives, `LucideAngularModule`.
- Produces: `<app-icon-rail />`, `<app-sidebar />`, `<app-toolbar />`.

- [ ] **Step 1: Implement `icon-rail`**

Create `frontend/src/app/layout/icon-rail.component.ts`:
```ts
import { Component, inject } from '@angular/core';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { UiService } from '../services/ui.service';
import { CommandPaletteService } from '../services/command-palette.service';

@Component({
  selector: 'app-icon-rail',
  standalone: true,
  imports: [UiIconButtonComponent],
  host: { class: 'flex w-12 flex-col items-center gap-2 border-r border-rustic-800 bg-rustic-900 py-3' },
  template: `
    <div class="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent font-display text-lg font-bold text-white">P</div>
    <ui-icon-button icon="search" label="Command palette (Ctrl+K)" (click)="palette.open()"></ui-icon-button>
    <ui-icon-button icon="folder-plus" label="New project" (click)="ui.openNewProject()"></ui-icon-button>
    <div class="mt-auto"></div>
    <ui-icon-button [icon]="ui.darkMode() ? 'sun' : 'moon'" label="Toggle theme" (click)="ui.toggleDarkMode()"></ui-icon-button>
  `,
})
export class IconRailComponent {
  readonly ui = inject(UiService);
  readonly palette = inject(CommandPaletteService);
}
```

- [ ] **Step 2: Implement `sidebar`** (project list + services tree)

Create `frontend/src/app/layout/sidebar.component.ts` using the existing sidebar behavior as reference (`components/sidebar/sidebar.component.ts`), rebuilt with primitives and the new tokens:
```ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiStatusDotComponent, UiIconButtonComponent],
  template: `
    <aside id="app-sidebar"
      class="z-40 flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface-raised transition-transform dark:border-rustic-700 dark:bg-rustic-800"
      [class.fixed]="ui.isMobile()" [class.-translate-x-full]="ui.isMobile() && !ui.sidebarOpen()">
      <div class="flex items-center justify-between border-b border-border px-4 py-3 dark:border-rustic-700">
        <span class="font-display text-sm font-bold uppercase tracking-[0.18em] text-accent">Projects</span>
        <ui-icon-button icon="plus" label="New project" (click)="ui.openNewProject()"></ui-icon-button>
      </div>
      <nav class="min-h-0 flex-1 overflow-auto p-2">
        @for (project of projectService.projects(); track project.id) {
          <button type="button" (click)="select(project.id)"
            class="mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
            [class]="project.id === projectService.activeProjectId()
              ? 'bg-accent/12 text-accent'
              : 'text-content hover:bg-rustic-100 dark:text-rustic-200 dark:hover:bg-rustic-700'">
            <lucide-icon name="folder" [size]="16"></lucide-icon>
            <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
            <span class="font-mono text-xs text-content-muted">{{ runningCount(project.id) }}/{{ project.services.length }}</span>
          </button>
          @if (project.id === projectService.activeProjectId()) {
            <div class="mb-2 ml-3 border-l border-border pl-2 dark:border-rustic-700">
              @for (service of project.services; track service.id) {
                <button type="button" (click)="mgr.open(project.id, service.id, service.name)"
                  class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-content-muted hover:bg-rustic-100 dark:hover:bg-rustic-700">
                  <ui-status-dot [status]="service.status"></ui-status-dot>
                  <span class="truncate">{{ service.name }}</span>
                </button>
              }
            </div>
          }
        }
      </nav>
    </aside>
  `,
})
export class SidebarComponent {
  readonly projectService = inject(ProjectService);
  readonly ui = inject(UiService);
  readonly mgr = inject(TerminalManager);

  select(id: string): void {
    this.projectService.setActiveProject(id);
    if (this.ui.isMobile()) this.ui.closeSidebar();
  }
  runningCount(projectId: string): number {
    return this.projectService.getProjectById(projectId)?.services.filter((s) => s.status === 'running').length ?? 0;
  }
}
```

- [ ] **Step 3: Implement `toolbar`**

Create `frontend/src/app/layout/toolbar.component.ts`:
```ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';
import { UiButtonComponent } from '../ui/ui-button.component';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiButtonComponent, UiBadgeComponent, UiIconButtonComponent],
  template: `
    @if (projectService.activeProject(); as project) {
      <div class="flex flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5 dark:border-rustic-700 dark:bg-rustic-800">
        @if (ui.isMobile()) {
          <ui-icon-button icon="menu" label="Open sidebar" (click)="ui.openSidebar()"></ui-icon-button>
        }
        <div class="min-w-0">
          <h1 class="truncate font-display text-lg font-bold text-content dark:text-rustic-100">{{ project.name }}</h1>
          <div class="flex items-center gap-1 truncate font-mono text-xs text-content-muted">
            <lucide-icon name="hard-drive" [size]="12"></lucide-icon>{{ project.rootPath }}
          </div>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <ui-badge tone="neutral">{{ running() }}/{{ project.services.length }} running</ui-badge>
          <ui-button variant="primary" size="sm" (click)="projectService.startAllServices(project.id)"><lucide-icon name="play" [size]="14"></lucide-icon>Start all</ui-button>
          <ui-button variant="secondary" size="sm" (click)="projectService.restartAllServices(project.id)"><lucide-icon name="refresh-cw" [size]="14"></lucide-icon>Restart</ui-button>
          <ui-button variant="secondary" size="sm" (click)="projectService.stopAllServices(project.id)"><lucide-icon name="square" [size]="14"></lucide-icon>Stop all</ui-button>
          <ui-button variant="ghost" size="sm" (click)="projectService.reloadProjectContext(project.id)"><lucide-icon name="rotate-cw" [size]="14"></lucide-icon>Reload</ui-button>
        </div>
      </div>
    }
  `,
})
export class ToolbarComponent {
  readonly projectService = inject(ProjectService);
  readonly ui = inject(UiService);
  running(): number {
    return this.projectService.activeServices().filter((s) => s.status === 'running').length;
  }
}
```

- [ ] **Step 4: Verify build compiles**

Run: `ng build`
Expected: build succeeds.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/layout/icon-rail.component.ts frontend/src/app/layout/sidebar.component.ts frontend/src/app/layout/toolbar.component.ts
git commit -m "feat(layout): add icon rail, sidebar, and toolbar"
```

---

## Task 11: `app-shell` + wire into `app.component`

**Files:**
- Create: `frontend/src/app/layout/app-shell.component.ts`
- Modify: `frontend/src/app/app.component.ts`

**Interfaces:**
- Consumes: all layout, dashboard container, terminal panel, floating terminals, command palette, config form, toast, `UiService`, `TerminalManager`, `ProjectService`.
- Produces: `<app-shell />` — the whole application frame.

- [ ] **Step 1: Implement `app-shell`**

Create `frontend/src/app/layout/app-shell.component.ts`:
```ts
import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconRailComponent } from './icon-rail.component';
import { SidebarComponent } from './sidebar.component';
import { ToolbarComponent } from './toolbar.component';
import { ServiceListComponent } from '../dashboard/service-list.component';
import { TerminalPanelComponent } from '../terminal/terminal-panel.component';
import { FloatingTerminalComponent } from '../terminal/floating-terminal.component';
import { CommandPaletteComponent } from '../components/command-palette/command-palette.component';
import { ConfigFormComponent } from '../components/config-form/config-form.component';
import { UiService } from '../services/ui.service';
import { ProjectService } from '../services/project.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, IconRailComponent, SidebarComponent, ToolbarComponent, ServiceListComponent,
    TerminalPanelComponent, FloatingTerminalComponent, CommandPaletteComponent, ConfigFormComponent],
  template: `
    <div class="flex h-screen w-screen overflow-hidden bg-surface font-sans text-content dark:bg-rustic-900 dark:text-rustic-100">
      @if (ui.isMobile() && ui.sidebarOpen()) {
        <button type="button" class="fixed inset-0 z-30 bg-rustic-950/50 md:hidden" (click)="ui.closeSidebar()" aria-label="Close sidebar"></button>
      }
      <app-icon-rail class="hidden md:flex"></app-icon-rail>
      <app-sidebar></app-sidebar>
      <main class="shell-main relative flex min-w-0 flex-1 flex-col">
        <app-toolbar></app-toolbar>
        <app-service-list></app-service-list>
        <app-terminal-panel></app-terminal-panel>
        <div class="pointer-events-none absolute inset-0 z-20">
          @for (t of mgr.floatingTerminals(); track t.serviceId) {
            <app-floating-terminal [terminal]="t" [status]="statusOf(t.serviceId)"></app-floating-terminal>
          }
        </div>
      </main>
      <app-command-palette></app-command-palette>
      @if (ui.configOpen()) { <app-config-form></app-config-form> }
      @if (ui.toast(); as toast) {
        <div class="fixed right-4 top-4 z-[70] w-full max-w-sm rounded-xl border px-4 py-3 shadow-float"
          [class]="toast.tone === 'success' ? 'border-accent/30 bg-accent/12 text-accent' : 'border-danger/30 bg-danger/12 text-danger'">
          <div class="text-sm font-bold uppercase tracking-wide">{{ toast.title }}</div>
          <div class="mt-1 text-sm text-content dark:text-rustic-200">{{ toast.message }}</div>
        </div>
      }
    </div>
  `,
})
export class AppShellComponent {
  readonly ui = inject(UiService);
  readonly mgr = inject(TerminalManager);
  private readonly projectService = inject(ProjectService);

  statusOf(serviceId: string): ServiceStatus {
    for (const p of this.projectService.projects()) {
      const s = p.services.find((svc) => svc.id === serviceId);
      if (s) return s.status;
    }
    return 'running';
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.ui.isMobile() && this.ui.sidebarOpen()) this.ui.closeSidebar(); }
}
```

- [ ] **Step 2: Reduce `app.component` to host the shell**

Replace `frontend/src/app/app.component.ts` entirely with:
```ts
import { Component } from '@angular/core';
import { AppShellComponent } from './layout/app-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppShellComponent],
  template: `<app-shell></app-shell>`,
})
export class AppComponent {}
```

- [ ] **Step 3: Verify build + existing app spec**

Run: `ng build`
Expected: build succeeds.
Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS. If `app.component.spec.ts` asserts old template text (e.g. the title), update it to assert the shell renders (`expect(fixture.nativeElement.querySelector('app-shell')).toBeTruthy()`).

- [ ] **Step 4: Manual smoke — the app runs end to end**

Start backend + frontend and confirm the new shell renders, a project is selectable, a service row's "open terminal" opens a docked tab, split/float/maximize work, dark mode toggles.
Run (two terminals, from repo root):
```bash
bun run --cwd apps/backend dev
bun run --cwd frontend start
```
Open the served URL; verify the flows above by hand.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/layout/app-shell.component.ts frontend/src/app/app.component.ts frontend/src/app/app.component.spec.ts
git commit -m "feat(layout): assemble app-shell and mount it from app root"
```

---

## Task 12: Command palette actions + config/toast polish

**Files:**
- Create: `frontend/src/app/services/command-registry.ts`
- Modify: `frontend/src/app/layout/app-shell.component.ts` (register commands on init)
- Modify: `frontend/src/app/components/command-palette/command-palette.component.ts` (restyle only)
- Modify: `frontend/src/app/components/config-form/config-form.component.ts` (restyle to primitives — visual only, keep logic)
- Create: `frontend/src/app/services/command-registry.spec.ts`

**Interfaces:**
- Consumes: `ProjectService`, `TerminalManager`, `UiService`, `Command` type from `CommandPaletteService`.
- Produces: `buildCommands(deps): Command[]` — projects (activate), services (start/stop/restart/open terminal/kill port), global (start/stop all, reload, toggle theme, new project).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/services/command-registry.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot find `./command-registry`.

- [ ] **Step 3: Implement `command-registry`**

Create `frontend/src/app/services/command-registry.ts`:
```ts
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
}

export function buildCommands(d: CommandDeps): Command[] {
  const cmds: Command[] = [];
  for (const project of d.projects()) {
    cmds.push({ id: `switch:${project.id}`, title: `Switch to ${project.name}`, icon: 'folder', action: () => d.setActiveProject(project.id) });
  }
  const active = d.activeProject();
  if (active) {
    cmds.push(
      { id: 'start-all', title: 'Start all services', icon: 'play', action: () => d.startAllServices(active.id) },
      { id: 'stop-all', title: 'Stop all services', icon: 'square', action: () => d.stopAllServices(active.id) },
      { id: 'restart-all', title: 'Restart all services', icon: 'refresh-cw', action: () => d.restartAllServices(active.id) },
      { id: 'reload-context', title: 'Reload project context', icon: 'rotate-cw', action: () => d.reloadProjectContext(active.id) },
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
```

- [ ] **Step 4: Register commands from `app-shell`**

In `frontend/src/app/layout/app-shell.component.ts`, add an `effect` in the constructor that rebuilds the palette commands whenever projects/active project change. Add imports for `CommandPaletteService` and `buildCommands`, inject the service, and in the constructor:
```ts
    effect(() => {
      const cmds = buildCommands({
        projects: () => this.projectService.projects(),
        activeProject: () => this.projectService.activeProject(),
        setActiveProject: (id) => this.projectService.setActiveProject(id),
        startService: (p, s) => this.projectService.startService(p, s),
        stopService: (p, s) => this.projectService.stopService(p, s),
        restartService: (p, s) => this.projectService.restartService(p, s),
        killServicePort: (p, s) => { void this.projectService.killServicePort(p, s); },
        startAllServices: (p) => this.projectService.startAllServices(p),
        stopAllServices: (p) => this.projectService.stopAllServices(p),
        restartAllServices: (p) => this.projectService.restartAllServices(p),
        reloadProjectContext: (p) => this.projectService.reloadProjectContext(p),
        openTerminal: (p, s, name) => this.mgr.open(p, s, name),
        toggleDarkMode: () => this.ui.toggleDarkMode(),
        openNewProject: () => this.ui.openNewProject(),
      });
      this.palette.clearCommands();
      this.palette.registerCommands(cmds);
    });
```
Add `readonly palette = inject(CommandPaletteService);` and `import { effect } from '@angular/core';` (extend the existing import) and `import { buildCommands } from '../services/command-registry';`.

- [ ] **Step 5: Restyle command palette and config form (visual only)**

Update `command-palette.component.ts` and `config-form.component.ts` Tailwind classes to use the new tokens/primitives (`surface-raised`, `border`, `accent`, `ui-button`, `ui-badge`). Do NOT change their logic or public inputs/outputs. Keep the palette's filtering behavior; ensure it renders `command.icon` and `command.title`.

- [ ] **Step 6: Run tests + build**

Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (command-registry spec green).
Run: `ng build`
Expected: build succeeds.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/app/services/command-registry.ts frontend/src/app/services/command-registry.spec.ts frontend/src/app/layout/app-shell.component.ts frontend/src/app/components/command-palette frontend/src/app/components/config-form
git commit -m "feat(ui): palette actions for services + restyle palette and config form"
```

---

## Task 13: Remove old components, responsive + final verification

**Files:**
- Delete: `frontend/src/app/components/dashboard/`, `frontend/src/app/components/sidebar/`, `frontend/src/app/components/service-card/`, `frontend/src/app/components/terminal/`
- Modify: `frontend/src/app/services/terminal.service.ts` (only if it still references removed components — it should not)

**Interfaces:**
- Consumes: everything built above.
- Produces: a clean tree with no dead components.

- [ ] **Step 1: Confirm nothing imports the old components**

Run (from `frontend/`):
```bash
grep -rn "components/dashboard\|components/sidebar\|components/service-card\|components/terminal" src/app --include=*.ts | grep -v "^src/app/components/"
```
Expected: no output (nothing outside those folders imports them). If there is output, fix the importer to use the new component before deleting.

- [ ] **Step 2: Delete the superseded component folders**

Run:
```bash
git rm -r frontend/src/app/components/dashboard frontend/src/app/components/sidebar frontend/src/app/components/service-card frontend/src/app/components/terminal
```

- [ ] **Step 3: Full build + test after removal**

Run: `ng build`
Expected: build succeeds with no missing-module errors.
Run: `ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (all specs).

- [ ] **Step 4: Manual responsive + dark-mode verification**

With backend + frontend running, resize to mobile width: sidebar collapses to overlay (hamburger in toolbar opens it), terminal panel stays usable, floating terminals remain draggable within `.shell-main`. Toggle dark mode from the rail; confirm surfaces, borders, and terminal themes all switch. Confirm ⌘K palette lists services and actions and that selecting "Open terminal: X" opens a docked tab.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "chore(ui): remove superseded components after redesign"
```

---

## Self-Review Notes

- **Spec coverage:** Design system → Task 1–2. `UiService` layout state → Task 3. Terminal modes (tab/split/float) → Tasks 4–7. Dashboard dense list + expandable row + execution plan + empty state → Tasks 8–9. Layout shell + rail + sidebar + toolbar → Tasks 10–11. Command palette actions + config/toast restyle → Task 12. Cleanup + responsive/dark verification → Task 13. Fonts self-hosted (no CDN) → Task 1.
- **Type consistency:** `OpenTerminal`, `FloatGeometry`, `TerminalManager` method names (`open/close/activate/toggleSplit/float/dock/toggleMaximize/setFloatGeometry/bringToFront`, signals `openTerminals/activeId/splitIds/dockedTerminals/floatingTerminals`, `zIndexMap`) are used identically across Tasks 4–7, 9–11. `UiService.terminalPanelHeight/setTerminalPanelHeight` consistent Tasks 3, 6. Primitive selectors (`ui-button/ui-icon-button/ui-status-dot/ui-badge/ui-panel`) consistent Tasks 2, 5–12. `buildCommands`/`CommandDeps` consistent Task 12.
- **Placeholder scan:** the `terminal-view` theme constants are explicitly "copy verbatim from the existing file" (a concrete, unambiguous instruction, not a TODO). No other placeholders.
- **Known coupling:** Task 12 keeps `command-palette` and `config-form` in `components/`; only their styles change, so Task 13 does NOT delete those two folders.
