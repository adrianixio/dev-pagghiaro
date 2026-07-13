import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, computed, inject, signal, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  CreateDebugWatchBody,
  DebugLanguage,
  DebugRecording,
  DebugRecordingSummary,
  DebugRecordingTrack,
  DebugSample,
  DebugWatch,
  DebugWatchPreset,
} from '@dev-pagghiaro/shared';
import { DEBUG_WATCH_PRESETS } from '@dev-pagghiaro/shared';
import { LucideAngularModule } from 'lucide-angular';
import {
  type AutoRecordingOptions,
  type DebugHistoryExportFormat,
  type DebugPanelRow,
  type DebugWatchUiState,
  DebugService,
} from '../../services/debug.service';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';

interface HistoryRow {
  key: string;
  timestamp: string;
  value: string;
  diff: string;
  changed: boolean;
  error: boolean;
}

interface SparklineDot {
  x: number;
  y: number;
  error: boolean;
}

interface SparklineModel {
  kind: 'empty' | 'numeric' | 'categorical';
  path: string;
  areaPath: string;
  dots: SparklineDot[];
  minLabel: string;
  maxLabel: string;
}

const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 34;
const SPARKLINE_PADDING = 4;
const PLAYER_SPARKLINE_WIDTH = 480;
const PLAYER_SPARKLINE_HEIGHT = 48;
const PLAYER_TICK_MS = 100;
const PLAYER_SPEEDS = [0.5, 1, 2, 4, 8] as const;
type PlayerSpeed = (typeof PLAYER_SPEEDS)[number];

@Component({
  selector: 'app-debug-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, CdkDropList, CdkDrag, CdkDragHandle],
  styles: [`
    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 0.75rem;
      box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.35);
    }
    .cdk-drag-placeholder {
      opacity: 0.28;
    }
    .cdk-drag-animating {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
    .debug-watch-list.cdk-drop-list-dragging .cdk-drag {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
  `],
  template: `
    <div class="fixed inset-0 z-50 flex overflow-y-auto bg-rustic-950/60 p-4 sm:p-6" (click)="close()">
      <div
        class="m-auto flex max-h-[92vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-xl border border-rustic-200 bg-white/95 p-4 shadow-float transition-colors duration-300 dark:border-rustic-700 dark:bg-rustic-900/95"
        role="dialog"
        aria-modal="true"
        aria-label="Debug watch panel"
        (click)="$event.stopPropagation()"
      >
      <header class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <lucide-icon name="bug" [size]="18" class="text-country-blue"></lucide-icon>
          <h3 class="text-sm font-bold uppercase tracking-[0.2em] text-rustic-900 dark:text-rustic-100">Debug Watch</h3>
        </div>
        <span class="rounded-full border px-2 py-0.5 text-[11px] font-mono"
              [class]="statusClass()">
          {{ session().status }}{{ session().language ? ' · ' + session().language : '' }}
        </span>
        <span class="rounded-full border border-rustic-200 bg-rustic-50 px-2 py-0.5 text-[11px] font-mono text-rustic-500 dark:border-rustic-700 dark:bg-rustic-800 dark:text-rustic-300">
          {{ session().watches.length }} watch{{ session().watches.length === 1 ? '' : 'es' }}
        </span>
        <button
          type="button"
          class="ml-auto flex items-center gap-1.5 rounded-md border border-rustic-200 px-2.5 py-1 text-xs font-medium text-rustic-600 transition-colors hover:bg-rustic-100 hover:text-rustic-900 dark:border-rustic-700 dark:text-rustic-300 dark:hover:bg-rustic-800 dark:hover:text-rustic-100"
          (click)="close()"
          aria-label="Close debug panel"
        >
          <lucide-icon name="x" [size]="14"></lucide-icon>
          Close
        </button>
      </header>

      @if (session().message) {
        <div class="rounded-lg border border-rustic-200 bg-rustic-50 px-3 py-2 text-xs text-rustic-700 dark:border-rustic-700 dark:bg-rustic-800/70 dark:text-rustic-200">
          {{ session().message }}
        </div>
      }

      <!-- Status banners: full-width so they never crowd the header or controls. -->
      @if (session().status === 'unsupported') {
        <div class="rounded-lg border border-dashed border-country-yellow/40 bg-country-yellow/10 px-3 py-2.5 text-xs text-rustic-700 dark:text-rustic-200">
          <span class="font-semibold text-country-yellow">Debug Watch isn't available for this runtime.</span>
          Node, Bun, and Python services expose live watch samples; other runtimes still run normally.
        </div>
      } @else if (isDetachedWhileRunning()) {
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-country-blue/30 bg-country-blue/10 px-3 py-2.5 text-xs text-rustic-700 dark:text-rustic-200">
          <div class="min-w-0">
            <span class="font-semibold text-country-blue">Inspector detached while the service is running.</span>
            Restart the service to re-open the runtime inspector and reattach your watches.
          </div>
          <button type="button" class="btn btn-secondary shrink-0 px-3 py-1 text-xs text-country-yellow" (click)="restartNow()">
            Restart now
          </button>
        </div>
      } @else if (debugEnabled() && session().status === 'detached') {
        <div class="rounded-lg border border-rustic-200 bg-rustic-50 px-3 py-2 text-xs text-rustic-600 dark:border-rustic-700 dark:bg-rustic-800/70 dark:text-rustic-300">
          Inspector support is enabled — start or restart the service when you are ready to attach.
        </div>
      }

      <!-- Settings: compact one-line toggles (full text on hover) instead of two tall cards. -->
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-rustic-200 bg-rustic-50/80 px-3 py-2 dark:border-rustic-700 dark:bg-rustic-800/50">
        <span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">
          <lucide-icon name="settings" [size]="13"></lucide-icon>
          Settings
        </span>
        <label
          class="flex cursor-pointer items-center gap-2 text-xs font-medium text-rustic-700 dark:text-rustic-200"
          title="Watches evaluate arbitrary expressions inside the target process. Keep this on only for the services you are actively debugging."
        >
          <input
            type="checkbox"
            [checked]="debugEnabled()"
            (change)="toggleDebugFlag($event)"
            class="rounded border-rustic-300 bg-white text-country-green focus:ring-country-green dark:border-rustic-600 dark:bg-rustic-800"
          />
          <span [class.text-country-green]="debugEnabled()">Enable inspector on next start</span>
        </label>
        <label
          class="flex cursor-pointer items-center gap-2 text-xs font-medium text-rustic-700 dark:text-rustic-200"
          title="Save the watch list (not the sample history) to pagghiaro.json so it reappears after a backend restart. Useful for repeatable debugging recipes."
        >
          <input
            type="checkbox"
            [checked]="persistWatchesEnabled()"
            (change)="togglePersistWatches($event)"
            class="rounded border-rustic-300 bg-white text-country-blue focus:ring-country-blue dark:border-rustic-600 dark:bg-rustic-800"
          />
          <span [class.text-country-blue]="persistWatchesEnabled()">Persist watches to config</span>
        </label>
      </div>

      <section class="flex flex-col gap-2 border-t border-rustic-200 pt-3 dark:border-rustic-700">
        <div class="flex items-center gap-2">
          <lucide-icon name="plus" [size]="15" class="text-country-green"></lucide-icon>
          <h4 class="text-xs font-bold uppercase tracking-[0.18em] text-rustic-700 dark:text-rustic-200">Add watch</h4>
          <button
            type="button"
            class="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rustic-500 transition-colors hover:bg-rustic-100 hover:text-rustic-800 dark:text-rustic-400 dark:hover:bg-rustic-800 dark:hover:text-rustic-100"
            [attr.aria-expanded]="showAdvancedWatch()"
            (click)="showAdvancedWatch.set(!showAdvancedWatch())"
          >
            <lucide-icon [name]="showAdvancedWatch() ? 'chevron-down' : 'chevron-right'" [size]="14"></lucide-icon>
            {{ showAdvancedWatch() ? 'Fewer options' : 'More options' }}
          </button>
        </div>

        <form (submit)="$event.preventDefault(); submitWatch()" class="flex flex-col gap-2">
          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Expression</span>
              <input
                type="text"
                [(ngModel)]="exprInput"
                name="expr"
                placeholder="globalThis.counter"
                class="input-field py-1.5 font-mono text-sm"
              />
            </label>
            <button type="submit" class="btn btn-secondary text-country-green md:h-[2.625rem]">Add watch</button>
          </div>

          @if (showAdvancedWatch()) {
            <div class="grid gap-2 md:grid-cols-[8rem_9rem_minmax(0,1fr)] md:items-end">
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Interval (ms)</span>
                <input
                  type="number"
                  [(ngModel)]="intervalInput"
                  name="interval"
                  min="50"
                  max="60000"
                  [disabled]="modeInput() === 'onChange'"
                  class="input-field py-1.5 font-mono text-sm disabled:opacity-50"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Mode</span>
                <select
                  [(ngModel)]="modeInput"
                  name="mode"
                  class="input-field py-1.5 font-mono text-sm"
                  title="interval = poll every N ms; onChange = JS uses property setters, Python dedupes consecutive equal values"
                >
                  <option value="interval">interval</option>
                  <option value="onChange">onChange</option>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Thread <span class="normal-case tracking-normal text-rustic-400">(Python)</span></span>
                <input
                  type="text"
                  [(ngModel)]="threadInput"
                  name="thread"
                  placeholder="MainThread"
                  title="Python only. Leave blank to use the main thread; substring match supported."
                  class="input-field py-1.5 font-mono text-sm"
                />
              </label>
            </div>
            <div class="grid gap-2 md:grid-cols-[12rem_10rem_minmax(0,1fr)] md:items-end">
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Label</span>
                <input
                  type="text"
                  [(ngModel)]="labelInput"
                  name="label"
                  placeholder="cart.total ($)"
                  class="input-field py-1.5 text-sm"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Group</span>
                <input
                  type="text"
                  [(ngModel)]="groupInput"
                  name="group"
                  placeholder="Request lifecycle"
                  title="Cluster this watch under a custom card alongside others sharing the same group name."
                  class="input-field py-1.5 text-sm"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Condition</span>
                <input
                  type="text"
                  [(ngModel)]="conditionInput"
                  name="condition"
                  placeholder="globalThis.counter > 100"
                  title="Sample is dropped when this expression is falsy. Works in both interval and onChange modes (JS + Python)."
                  class="input-field py-1.5 font-mono text-sm"
                />
              </label>
            </div>
          }
        </form>

        @if (showAdvancedWatch()) {
          <div
            class="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3 text-xs text-rustic-600 dark:text-rustic-300"
            [ngClass]="isDragOver()
              ? 'border-country-blue bg-country-blue/10'
              : 'border-rustic-300 bg-rustic-50/70 dark:border-rustic-600 dark:bg-rustic-800/40'"
            (dragover)="onPresetDragOver($event)"
            (dragleave)="onPresetDragLeave($event)"
            (drop)="onPresetDrop($event)"
          >
            <label class="flex flex-col gap-1 min-w-[14rem]">
              <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Apply template</span>
              <select
                [(ngModel)]="selectedPresetId"
                name="presetId"
                class="input-field py-1.5 text-sm"
                [disabled]="availablePresets().length === 0"
              >
                <option value="">— pick a preset —</option>
                @for (preset of availablePresets(); track preset.id) {
                  <option [value]="preset.id" [title]="preset.description">{{ presetLabel(preset) }}</option>
                }
              </select>
            </label>
            <button type="button" class="btn btn-secondary px-3 py-1 text-xs text-country-blue" [disabled]="!selectedPresetId()" (click)="applyPreset()">
              Apply
            </button>

            <span class="mx-1 hidden h-8 w-px bg-rustic-300 dark:bg-rustic-600 md:inline-block"></span>

            <button type="button" class="btn btn-secondary px-3 py-1 text-xs text-country-green" (click)="exportPreset()" [disabled]="session().watches.length === 0">
              Export preset
            </button>

            <label class="btn btn-secondary cursor-pointer px-3 py-1 text-xs text-country-yellow">
              Import file…
              <input type="file" accept="application/json,.json" class="hidden" (change)="onPresetFileSelected($event)" />
            </label>

            <span class="ml-auto text-[10px] italic text-rustic-500 dark:text-rustic-400">
              {{ isDragOver() ? 'Drop the JSON file to import…' : 'Or drag a JSON preset onto this area' }}
            </span>

            @if (importMessage(); as msg) {
              <div class="basis-full pt-1 text-[11px] font-mono"
                   [class.text-country-green]="msg.tone === 'ok'"
                   [class.text-country-red]="msg.tone === 'error'">
                {{ msg.text }}
              </div>
            }
          </div>
        }
      </section>

      <section class="flex flex-col gap-3 border-t border-rustic-200 pt-3 dark:border-rustic-700">
      <div class="flex flex-wrap items-center gap-2">
        <lucide-icon name="list-ordered" [size]="15" class="text-country-blue"></lucide-icon>
        <h4 class="text-xs font-bold uppercase tracking-[0.18em] text-rustic-700 dark:text-rustic-200">Watches</h4>
        @if (session().watches.length > 0) {
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn btn-secondary px-3 py-1 text-xs"
              [class.text-country-blue]="groupBySource()"
              (click)="toggleGroupBySource()"
            >
              {{ groupBySource() ? 'Grouped by source' : 'Flat order' }}
            </button>
            <button
              type="button"
              class="btn btn-secondary flex items-center gap-2 px-3 py-1 text-xs"
              [class.opacity-60]="!canExportSession()"
              [disabled]="!canExportSession()"
              (click)="exportSession()"
            >
              <lucide-icon name="arrow-down-to-line" [size]="13"></lucide-icon>
              Export session JSON
            </button>
          </div>
        }
      </div>

      @if (session().watches.length === 0) {
        <div class="rounded-xl border border-dashed border-rustic-300 bg-rustic-50/90 px-4 py-5 text-sm text-rustic-500 dark:border-rustic-700 dark:bg-rustic-800/50 dark:text-rustic-400">
          <div class="font-semibold text-rustic-700 dark:text-rustic-200">No watches yet.</div>
          <p class="mt-1">
            Add an expression like <code class="font-mono text-country-blue">globalThis.counter</code>, <code class="font-mono text-country-blue">process.env.NODE_ENV</code>, or <code class="font-mono text-country-blue">request.state.user</code> to start sampling live values.
          </p>
        </div>
      } @else {
        <div class="debug-watch-list flex flex-col gap-3" cdkDropList (cdkDropListDropped)="drop($event)">
          @for (row of watchRows(); track row.key) {
            @if (row.kind === 'header') {
              <div class="flex items-center gap-2 px-1 pt-1 text-[10px] uppercase tracking-[0.24em] text-rustic-500 dark:text-rustic-400">
                <span class="h-px flex-1 bg-rustic-200 dark:bg-rustic-700"></span>
                <span>{{ row.source }}</span>
                <span class="h-px flex-1 bg-rustic-200 dark:bg-rustic-700"></span>
              </div>
            } @else {
              <div cdkDrag class="rounded-xl border border-rustic-200 bg-white/90 p-3 shadow-sm transition-colors duration-300 dark:border-rustic-700 dark:bg-rustic-900/70">
                <div class="flex gap-3">
                  <div class="flex items-start justify-center pt-1 text-rustic-400 transition-colors hover:text-rustic-600 dark:text-rustic-500 dark:hover:text-rustic-300"
                       cdkDragHandle>
                    <lucide-icon name="grip-vertical" [size]="18"></lucide-icon>
                  </div>

                  <div class="min-w-0 flex-1 space-y-3">
                    <div class="flex flex-wrap items-start gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          @if (row.watch.label) {
                            <span class="min-w-0 break-words text-sm font-semibold text-rustic-900 dark:text-rustic-100">
                              {{ row.watch.label }}
                            </span>
                          } @else {
                            <code class="min-w-0 break-all text-xs font-mono text-rustic-900 dark:text-rustic-100">{{ row.watch.expr }}</code>
                          }
                          <span class="rounded-full border border-country-blue/30 bg-country-blue/10 px-2 py-0.5 text-[10px] font-mono text-country-blue">
                            {{ row.source }}
                          </span>
                          @if (watchUi(row.watch.id).paused) {
                            <span class="rounded-full border border-country-yellow/30 bg-country-yellow/10 px-2 py-0.5 text-[10px] font-mono text-country-yellow">
                              paused locally
                            </span>
                          }
                        </div>
                        @if (row.watch.label) {
                          <code class="mt-1 block break-all text-[10px] font-mono text-rustic-500 dark:text-rustic-400">{{ row.watch.expr }}</code>
                        }
                        <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-rustic-500 dark:text-rustic-400">
                          <span
                            class="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider"
                            [ngClass]="row.watch.mode === 'onChange'
                              ? 'border-country-blue/40 bg-country-blue/10 text-country-blue'
                              : 'border-rustic-300 dark:border-rustic-600'"
                          >
                            {{ row.watch.mode }}
                          </span>
                          @if (row.watch.mode === 'interval') {
                            <span>{{ row.watch.intervalMs }}ms</span>
                            <span>•</span>
                          }
                          @if (row.watch.threadName) {
                            <span class="rounded-full border border-country-pink/40 bg-country-pink/10 px-2 py-0.5 text-[10px] text-country-pink">
                              thread: {{ row.watch.threadName }}
                            </span>
                            <span>•</span>
                          }
                          @if (row.watch.condition) {
                            <span
                              class="rounded-full border border-country-yellow/40 bg-country-yellow/10 px-2 py-0.5 text-[10px] text-country-yellow"
                              [title]="'Sample only when truthy: ' + row.watch.condition"
                            >
                              if: {{ row.watch.condition }}
                            </span>
                            <span>•</span>
                          }
                          @if (row.watch.groupName) {
                            <span
                              class="rounded-full border border-rustic-400 bg-rustic-100 px-2 py-0.5 text-[10px] text-rustic-700 dark:border-rustic-500 dark:bg-rustic-800 dark:text-rustic-200"
                              title="Custom group"
                            >
                              group: {{ row.watch.groupName }}
                            </span>
                            <span>•</span>
                          }
                          <span>{{ historyOf(row.watch.id).length }}/{{ row.watch.bufferSize }} samples</span>
                          @if (latest(row.watch.id); as latestSample) {
                            <span>•</span>
                            <span>{{ formatTimestamp(latestSample.t) }}</span>
                          }
                        </div>
                      </div>

                      <div class="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          class="btn btn-secondary px-2.5 py-1 text-xs"
                          [class.text-country-yellow]="watchUi(row.watch.id).paused"
                          [class.text-country-green]="!watchUi(row.watch.id).paused"
                          (click)="togglePause(row.watch.id)"
                        >
                          {{ watchUi(row.watch.id).paused ? 'Resume' : 'Pause' }}
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary px-2.5 py-1 text-xs"
                          [class.text-country-blue]="watchUi(row.watch.id).historyExpanded"
                          (click)="toggleHistory(row.watch.id)"
                        >
                          {{ watchUi(row.watch.id).historyExpanded ? 'Hide history' : 'Show history' }}
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary px-2.5 py-1 text-xs text-country-blue"
                          (click)="copyWatchJson(row.watch.id)"
                        >
                          Copy JSON
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary px-2.5 py-1 text-xs text-country-red"
                          (click)="remove(row.watch.id)"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
                      <div class="rounded-lg border border-rustic-200 bg-rustic-50/80 px-3 py-3 dark:border-rustic-700 dark:bg-rustic-800/60">
                        <div class="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">
                          <span>Recent samples</span>
                          <span>{{ sparklineLabel(row.watch.id) }}</span>
                        </div>
                        @if (sparklineFor(row.watch.id); as sparkline) {
                          @if (sparkline.kind === 'empty') {
                            <div class="flex h-[3.75rem] items-center justify-center rounded-lg border border-dashed border-rustic-300 text-xs italic text-rustic-400 dark:border-rustic-700 dark:text-rustic-500">
                              awaiting samples…
                            </div>
                          } @else {
                            <svg
                              class="h-[3.75rem] w-full overflow-visible"
                              [class.opacity-60]="watchUi(row.watch.id).paused"
                              [attr.viewBox]="sparklineViewBox"
                              preserveAspectRatio="none"
                              role="img"
                              [attr.aria-label]="'Sparkline for ' + row.watch.expr"
                            >
                              <line x1="0" [attr.y1]="sparklineMidline" [attr.x2]="sparklineWidth" [attr.y2]="sparklineMidline"
                                    class="text-rustic-200 dark:text-rustic-700" stroke="currentColor" stroke-width="1"></line>
                              @if (sparkline.kind === 'numeric') {
                                <path [attr.d]="sparkline.areaPath" class="text-country-blue opacity-15" fill="currentColor"></path>
                                <path [attr.d]="sparkline.path" class="text-country-blue" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                              } @else {
                                @for (dot of sparkline.dots; track $index) {
                                  <circle
                                    [attr.cx]="dot.x"
                                    [attr.cy]="dot.y"
                                    r="2.4"
                                    [attr.fill]="dot.error ? 'currentColor' : 'currentColor'"
                                    [attr.class]="dot.error ? 'text-country-red' : 'text-country-blue'"
                                  ></circle>
                                }
                              }
                            </svg>
                            <div class="mt-2 flex items-center justify-between text-[11px] font-mono text-rustic-500 dark:text-rustic-400">
                              <span>{{ sparkline.minLabel }}</span>
                              <span>{{ sparkline.maxLabel }}</span>
                            </div>
                          }
                        }
                      </div>

                      <div
                        class="rounded-lg border px-3 py-3 transition-colors"
                        [ngClass]="latest(row.watch.id)?.valueChanged
                          ? 'border-country-green/50 bg-country-green/5 dark:bg-country-green/10'
                          : 'border-rustic-200 bg-white/80 dark:border-rustic-700 dark:bg-rustic-900/50'"
                      >
                        <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">
                          <span>{{ latest(row.watch.id)?.error ? 'Last error' : 'Current value' }}</span>
                          @if (latest(row.watch.id)?.valueChanged) {
                            <span class="rounded-full border border-country-green/40 bg-country-green/10 px-2 py-0.5 text-[9px] font-mono normal-case text-country-green">
                              changed
                            </span>
                          }
                        </div>
                        @if (latest(row.watch.id); as sample) {
                          @if (sample.error) {
                            <div class="mt-2 text-sm font-mono text-country-red">{{ sample.error }}</div>
                          } @else {
                            <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-rustic-700 dark:text-rustic-200">{{ formatValue(sample.value) }}</pre>
                          }
                          <div class="mt-2 text-[11px] font-mono text-rustic-500 dark:text-rustic-400">{{ formatTimestamp(sample.t) }}</div>
                        } @else {
                          <div class="mt-2 text-xs italic text-rustic-400 dark:text-rustic-500">No retained sample yet.</div>
                        }
                      </div>
                    </div>

                    <div class="rounded-lg border border-dashed border-rustic-300 bg-rustic-50/70 px-3 py-3 dark:border-rustic-700 dark:bg-rustic-800/50">
                      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div class="text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">Time-range export</div>
                          <p class="mt-1 text-xs text-rustic-500 dark:text-rustic-400">
                            Download samples from the backend ring buffer for the selected window.
                          </p>
                        </div>
                        <button type="button" class="text-xs font-medium text-country-blue hover:text-opacity-80" (click)="resetExportRange(row.watch.id)">
                          Use live range
                        </button>
                      </div>
                      <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
                        <label class="flex flex-col gap-1">
                          <span class="text-[10px] uppercase tracking-[0.16em] text-rustic-500 dark:text-rustic-400">From</span>
                          <input
                            type="datetime-local"
                            [ngModel]="watchUi(row.watch.id).exportFrom"
                            (ngModelChange)="setExportFrom(row.watch.id, $event)"
                            [ngModelOptions]="{ standalone: true }"
                            class="rounded-md border border-rustic-300 bg-white px-2 py-1.5 font-mono text-[11px] text-rustic-700 outline-none transition-colors focus:border-country-blue dark:border-rustic-600 dark:bg-rustic-900 dark:text-rustic-200"
                          />
                        </label>
                        <label class="flex flex-col gap-1">
                          <span class="text-[10px] uppercase tracking-[0.16em] text-rustic-500 dark:text-rustic-400">To</span>
                          <input
                            type="datetime-local"
                            [ngModel]="watchUi(row.watch.id).exportTo"
                            (ngModelChange)="setExportTo(row.watch.id, $event)"
                            [ngModelOptions]="{ standalone: true }"
                            class="rounded-md border border-rustic-300 bg-white px-2 py-1.5 font-mono text-[11px] text-rustic-700 outline-none transition-colors focus:border-country-blue dark:border-rustic-600 dark:bg-rustic-900 dark:text-rustic-200"
                          />
                        </label>
                        <button type="button" class="btn btn-secondary px-3 py-1.5 text-xs text-country-blue" (click)="exportWatch(row.watch, 'json')">
                          JSON
                        </button>
                        <button type="button" class="btn btn-secondary px-3 py-1.5 text-xs text-country-green" (click)="exportWatch(row.watch, 'csv')">
                          CSV
                        </button>
                      </div>
                    </div>

                    @if (watchUi(row.watch.id).historyExpanded) {
                      <div class="overflow-hidden rounded-lg border border-rustic-200 dark:border-rustic-700">
                        <div class="grid grid-cols-[9rem_minmax(0,1fr)_7rem] gap-2 border-b border-rustic-200 bg-rustic-50 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:border-rustic-700 dark:bg-rustic-800 dark:text-rustic-400">
                          <span>Timestamp</span>
                          <span>Value</span>
                          <span>Diff</span>
                        </div>
                        <div class="max-h-56 overflow-y-auto bg-white/80 dark:bg-rustic-900/50">
                          @if (historyRows(row.watch.id).length === 0) {
                            <div class="px-3 py-4 text-xs italic text-rustic-400 dark:text-rustic-500">No retained samples yet.</div>
                          } @else {
                            @for (historyRow of historyRows(row.watch.id); track historyRow.key) {
                              <div class="grid grid-cols-[9rem_minmax(0,1fr)_7rem] gap-2 border-b border-rustic-100 px-3 py-2 text-xs dark:border-rustic-800/70">
                                <span class="font-mono text-[11px] text-rustic-500 dark:text-rustic-400">{{ historyRow.timestamp }}</span>
                                <span class="min-w-0 break-all font-mono"
                                      [class.text-country-red]="historyRow.error"
                                      [class.text-rustic-700]="!historyRow.error"
                                      [class.dark:text-rustic-200]="!historyRow.error">
                                  {{ historyRow.value }}
                                </span>
                                <span class="font-mono text-[11px]"
                                      [class.text-country-green]="historyRow.changed && !historyRow.error"
                                      [class.text-country-red]="historyRow.error"
                                      [class.text-rustic-400]="!historyRow.changed && !historyRow.error"
                                      [class.dark:text-rustic-500]="!historyRow.changed && !historyRow.error">
                                  {{ historyRow.diff }}
                                </span>
                              </div>
                            }
                          }
                        </div>
                      </div>
                    }
                  </div>
                </div>
              </div>
            }
          }
        </div>
      }

      </section>

      <section class="rounded-xl border border-country-blue/30 bg-country-blue/5 p-3">
        <button
          type="button"
          class="flex w-full flex-wrap items-center gap-2 text-left"
          [attr.aria-expanded]="recordingsOpen()"
          (click)="recordingsOpen.set(!recordingsOpen())"
        >
          <lucide-icon name="activity" [size]="16" class="text-country-blue"></lucide-icon>
          <h4 class="text-xs font-bold uppercase tracking-[0.18em] text-country-blue">Recordings</h4>
          @if (activeRecording(); as active) {
            <span class="rounded-full border border-country-red/40 bg-country-red/10 px-2 py-0.5 text-[11px] font-mono text-country-red">
              ● recording · {{ active.sampleCount }} samples · {{ recordingDurationLabel() }}
            </span>
          } @else if (finishedRecordings().length > 0) {
            <span class="rounded-full border border-rustic-300 bg-white/70 px-2 py-0.5 text-[11px] font-mono text-rustic-500 dark:border-rustic-600 dark:bg-rustic-800 dark:text-rustic-300">
              {{ finishedRecordings().length }} saved
            </span>
          }
          <lucide-icon [name]="recordingsOpen() ? 'chevron-down' : 'chevron-right'" [size]="16" class="ml-auto text-rustic-500 dark:text-rustic-400"></lucide-icon>
        </button>
        @if (recordingsOpen()) {
        <p class="mt-2 text-[11px] text-rustic-500 dark:text-rustic-400">
          Capture every sample from every watch into a named, sealed snapshot. Lives in memory only — not persisted across backend restarts.
        </p>

        <form (submit)="$event.preventDefault(); toggleRecording()" class="mt-3 flex flex-col gap-2">
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-1 min-w-[14rem] flex-col gap-1">
              <span class="text-[10px] uppercase tracking-[0.18em] text-rustic-500 dark:text-rustic-400">Recording name (optional)</span>
              <input
                type="text"
                [(ngModel)]="recordingNameInput"
                name="recName"
                placeholder="auto-named with timestamp if empty"
                [disabled]="!!activeRecording()"
                class="input-field py-1.5 text-sm disabled:opacity-50"
              />
            </label>
            @if (activeRecording()) {
              <button type="submit" class="btn btn-secondary text-country-red">Stop recording</button>
            } @else {
              <button type="submit" class="btn btn-secondary text-country-blue" [disabled]="!canStartRecording()">
                Start recording
              </button>
            }
          </div>
          <div class="flex flex-wrap gap-3 text-[11px] text-rustic-600 dark:text-rustic-300">
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                [checked]="recordingIncludeLogs()"
                (change)="recordingIncludeLogs.set($any($event.target).checked)"
                [disabled]="!!activeRecording()"
              />
              Capture stdout/stderr
            </label>
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                [checked]="recordingIncludeMetrics()"
                (change)="recordingIncludeMetrics.set($any($event.target).checked)"
                [disabled]="!!activeRecording()"
              />
              Capture CPU/RAM metrics
            </label>
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                [checked]="recordingIncludeStatus()"
                (change)="recordingIncludeStatus.set($any($event.target).checked)"
                [disabled]="!!activeRecording()"
              />
              Capture status changes
            </label>
            <span class="ml-auto italic text-rustic-400 dark:text-rustic-500">
              Watch samples are always captured.
            </span>
          </div>
        </form>

        <form (submit)="$event.preventDefault(); startAutoRecording()" class="mt-2 rounded-lg border border-country-yellow/30 bg-country-yellow/5 p-3">
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-country-yellow"
            [attr.aria-expanded]="showAutoRecord()"
            (click)="showAutoRecord.set(!showAutoRecord())"
          >
            <lucide-icon [name]="showAutoRecord() ? 'chevron-down' : 'chevron-right'" [size]="13"></lucide-icon>
            Auto-record everything (experimental)
          </button>
          @if (showAutoRecord()) {
          <div class="mt-2 grid gap-2 md:grid-cols-3">
            <label class="flex flex-col gap-1 text-[11px]">
              <span>Interval ms</span>
              <input type="number" min="250" max="10000" [ngModel]="autoIntervalMs()" (ngModelChange)="autoIntervalMs.set($event)" [ngModelOptions]="{ standalone: true }" class="input-field py-1.5 font-mono text-sm" [disabled]="!!activeRecording()" />
            </label>
            <label class="flex flex-col gap-1 text-[11px]">
              <span>Max snapshots</span>
              <input type="number" min="1" max="500" [ngModel]="autoMaxSnapshots()" (ngModelChange)="autoMaxSnapshots.set($event)" [ngModelOptions]="{ standalone: true }" class="input-field py-1.5 font-mono text-sm" [disabled]="!!activeRecording()" />
            </label>
            <label class="flex flex-col gap-1 text-[11px]">
              <span>Frame depth</span>
              <input type="number" min="1" max="10" [ngModel]="autoFrameDepth()" (ngModelChange)="autoFrameDepth.set($event)" [ngModelOptions]="{ standalone: true }" class="input-field py-1.5 font-mono text-sm" [disabled]="!!activeRecording()" />
            </label>
          </div>
          <label class="mt-2 flex flex-col gap-1 text-[11px]">
            <span>Exclude frame regex</span>
            <input type="text" [ngModel]="autoExcludeRegex()" (ngModelChange)="autoExcludeRegex.set($event)" [ngModelOptions]="{ standalone: true }" class="input-field py-1.5 font-mono text-sm" [disabled]="!!activeRecording()" />
          </label>
          <div class="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            <label class="flex items-center gap-1"><input type="checkbox" [checked]="autoIncludeClosures()" (change)="autoIncludeClosures.set($any($event.target).checked)" [disabled]="!!activeRecording()" /> include closures</label>
            <label class="flex items-center gap-1"><input type="checkbox" [checked]="autoIncludeUserGlobals()" (change)="autoIncludeUserGlobals.set($any($event.target).checked)" [disabled]="!!activeRecording()" /> include user globals</label>
            <button type="submit" class="ml-auto btn btn-secondary px-3 py-1 text-xs text-country-yellow" [disabled]="!!activeRecording() || !canStartRecording()">Start auto-recording</button>
          </div>
          }
        </form>

        @if (playerRecording(); as player) {
          <div class="mt-3 rounded-lg border border-country-yellow/40 bg-country-yellow/5 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[10px] uppercase tracking-[0.2em] text-country-yellow">Time-travel player</span>
              <span class="text-sm font-semibold text-rustic-900 dark:text-rustic-100">{{ player.name }}</span>
              <span class="font-mono text-[11px] text-rustic-500 dark:text-rustic-400">
                {{ formatTimestamp(player.startedAt) }} → {{ player.endedAt ? formatTimestamp(player.endedAt) : '—' }} · {{ formatPlayhead(playerDurationMs()) }} total
              </span>
              <button type="button" class="ml-auto btn btn-secondary px-2 py-1 text-[11px] text-rustic-600 dark:text-rustic-300" (click)="closeRecordingPlayer()">Close</button>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn-secondary px-3 py-1 text-xs text-country-yellow" (click)="togglePlayerPlay()">
                {{ playerPlaying() ? '⏸ Pause' : '▶ Play' }}
              </button>
              <label class="flex items-center gap-1 text-[11px] text-rustic-600 dark:text-rustic-300">
                Speed
                <select
                  [ngModel]="playerSpeed()"
                  (ngModelChange)="setPlayerSpeed($event)"
                  class="rounded border border-rustic-300 bg-white px-2 py-1 font-mono text-[11px] dark:border-rustic-600 dark:bg-rustic-800"
                >
                  @for (speed of playerSpeedOptions; track speed) {
                    <option [value]="speed">{{ speed }}x</option>
                  }
                </select>
              </label>
              <input
                type="range"
                min="0"
                [max]="playerDurationMs()"
                step="50"
                [value]="playerPlayheadMs()"
                (input)="setPlayerPlayhead($any($event.target).value)"
                class="flex-1 min-w-[12rem] accent-country-yellow"
              />
              <span class="font-mono text-xs tabular-nums text-rustic-700 dark:text-rustic-200">
                {{ formatPlayhead(playerPlayheadMs()) }} / {{ formatPlayhead(playerDurationMs()) }}
              </span>
            </div>

            @if ((player.kind ?? 'manual') === 'auto') {
              @if (nearestSnapshot(player); as snap) {
                <div class="mt-3 rounded border border-rustic-200 bg-white/70 p-3 dark:border-rustic-700 dark:bg-rustic-900/40">
                  <div class="text-[11px] font-mono text-rustic-500 dark:text-rustic-400">snapshot {{ formatTimestamp(snap.t) }}</div>
                  @if (snap.error) {
                    <div class="mt-2 text-xs text-country-red">{{ snap.error }}</div>
                  }
                  @for (frame of snap.frames; track $index) {
                    <details class="mt-2 rounded border border-rustic-200 p-2 dark:border-rustic-700" open>
                      <summary class="font-mono text-xs">{{ frame.file }}:{{ frame.line }} · {{ frame.function }}</summary>
                      <pre class="mt-2 text-[11px] font-mono">locals: {{ formatValue(frame.locals) }}</pre>
                      <pre class="mt-1 text-[11px] font-mono">closures: {{ formatValue(frame.closures) }}</pre>
                    </details>
                  }
                  <details class="mt-2 rounded border border-rustic-200 p-2 dark:border-rustic-700">
                    <summary class="font-mono text-xs">user globals</summary>
                    <pre class="mt-2 text-[11px] font-mono">{{ formatValue(snap.userGlobals) }}</pre>
                  </details>
                </div>
              }
            } @else {
            <ul class="mt-3 flex flex-col gap-2">
              @for (track of player.tracks; track track.watch.id) {
                <li class="flex flex-wrap items-center gap-3 rounded border border-rustic-200 bg-white/70 px-3 py-2 dark:border-rustic-700 dark:bg-rustic-900/40">
                  <div class="min-w-[10rem] flex-1">
                    <div class="text-xs font-semibold text-rustic-900 dark:text-rustic-100">
                      {{ track.watch.label || track.watch.expr }}
                    </div>
                    <div class="font-mono text-[10px] text-rustic-500 dark:text-rustic-400">{{ track.samples.length }} samples</div>
                  </div>
                  @if (playerSparkline(track); as s) {
                    @if (s.kind === 'empty') {
                      <span class="font-mono text-[10px] italic text-rustic-400">no samples</span>
                    } @else {
                      <svg [attr.width]="playerSparklineWidth" [attr.height]="playerSparklineHeight" [attr.viewBox]="playerSparklineViewBox" class="overflow-visible">
                        @if (s.kind === 'numeric') {
                          <path [attr.d]="s.areaPath" class="text-country-yellow opacity-15" fill="currentColor"></path>
                          <path [attr.d]="s.path" fill="none" class="text-country-yellow" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"></path>
                        } @else {
                          @for (dot of s.dots; track $index) {
                            <circle [attr.cx]="dot.x" [attr.cy]="dot.y" r="2"
                              [attr.class]="dot.error ? 'fill-country-red' : 'fill-country-blue'"></circle>
                          }
                        }
                        <line [attr.x1]="s.playheadX" y1="0" [attr.x2]="s.playheadX" [attr.y2]="playerSparklineHeight" stroke="currentColor" class="text-country-red" stroke-width="1.2" stroke-dasharray="3 2"></line>
                      </svg>
                    }
                  }
                  <div class="min-w-[8rem] text-right">
                    @if (valueAtPlayhead(track); as sample) {
                      @if (sample.error) {
                        <span class="font-mono text-xs text-country-red">err: {{ sample.error }}</span>
                      } @else {
                        <span class="font-mono text-xs text-rustic-900 dark:text-rustic-100">{{ formatValue(sample.value) }}</span>
                      }
                    } @else {
                      <span class="font-mono text-[10px] italic text-rustic-400">no sample yet</span>
                    }
                  </div>
                </li>
              }
            </ul>
            }

            @if (player.statusChanges?.length) {
              <div class="mt-3">
                <div class="text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">Status changes</div>
                <ul class="mt-1 flex flex-wrap gap-1 font-mono text-[10px]">
                  @for (change of player.statusChanges ?? []; track $index) {
                    <li class="rounded border border-rustic-300 bg-white px-2 py-0.5 dark:border-rustic-600 dark:bg-rustic-800"
                        [class.text-country-green]="change.status === 'running'"
                        [class.text-country-red]="change.status === 'error'"
                        [class.text-country-yellow]="change.status === 'restarting'">
                      {{ formatTimestamp(change.t) }} → {{ change.status }}{{ change.pid ? ' (pid ' + change.pid + ')' : '' }}
                    </li>
                  }
                </ul>
              </div>
            }

            @if (player.metrics?.length) {
              <div class="mt-3">
                <div class="text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">CPU / RAM samples</div>
                <div class="mt-1 font-mono text-[11px] text-rustic-600 dark:text-rustic-300">
                  Captured {{ player.metrics?.length }} measurement{{ (player.metrics?.length ?? 0) === 1 ? '' : 's' }}.
                  Latest cpu / mem at playhead:
                  @if (metricsAtPlayhead(); as m) {
                    <span class="text-rustic-900 dark:text-rustic-100">{{ m.cpu | number:'1.1-1' }}% CPU · {{ m.memoryBytes / 1024 / 1024 | number:'1.0-0' }} MB</span>
                  } @else {
                    <span class="italic text-rustic-400">no sample yet</span>
                  }
                </div>
              </div>
            }

            @if (player.logs?.length) {
              <div class="mt-3">
                <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">
                  <span>Captured logs</span>
                  <span class="font-mono normal-case">{{ logsUpToPlayhead().length }} / {{ player.logs?.length ?? 0 }} lines up to playhead</span>
                </div>
                <pre class="mt-1 max-h-48 overflow-y-auto rounded border border-rustic-200 bg-black/85 p-2 font-mono text-[10px] leading-snug text-rustic-100 dark:border-rustic-700">{{ logsJoinedUpToPlayhead() }}</pre>
              </div>
            }
          </div>
        }

        @if (finishedRecordings().length === 0) {
          <p class="mt-3 text-[11px] italic text-rustic-400 dark:text-rustic-500">No recordings yet.</p>
        } @else {
          <ul class="mt-3 flex flex-col gap-2">
            @for (recording of finishedRecordings(); track recording.id) {
              <li class="flex flex-wrap items-center gap-2 rounded-lg border border-rustic-200 bg-white/80 px-3 py-2 text-xs dark:border-rustic-700 dark:bg-rustic-900/50">
                <div class="min-w-0 flex-1">
                  <div class="font-semibold text-rustic-900 dark:text-rustic-100">{{ recording.name }}</div>
                  <div class="mt-0.5 font-mono text-[10px] text-rustic-500 dark:text-rustic-400">
                    {{ formatTimestamp(recording.startedAt) }}
                    @if (recording.endedAt) { → {{ formatTimestamp(recording.endedAt) }} }
                    · {{ recording.watchCount }} watch{{ recording.watchCount === 1 ? '' : 'es' }}
                    · {{ recording.sampleCount }} sample{{ recording.sampleCount === 1 ? '' : 's' }}
                    @if (recording.includeLogs) { · {{ recording.logCount ?? 0 }} log }
                    @if (recording.includeMetrics) { · {{ recording.metricCount ?? 0 }} metric }
                    @if (recording.includeStatus) { · {{ recording.statusCount ?? 0 }} status }
                    @if ((recording.kind ?? 'manual') === 'auto') { · auto · {{ recording.snapshotCount ?? 0 }} snapshots }
                  </div>
                </div>
                <button type="button" class="btn btn-secondary px-2 py-1 text-[11px] text-country-yellow" (click)="openRecordingPlayer(recording)" title="Open in time-travel player">▶ Play</button>
                <button type="button" class="btn btn-secondary px-2 py-1 text-[11px] text-country-blue" (click)="exportRecording(recording, 'json')">JSON</button>
                <button type="button" class="btn btn-secondary px-2 py-1 text-[11px] text-country-green" (click)="exportRecording(recording, 'csv')">CSV</button>
                <button type="button" class="btn btn-secondary px-2 py-1 text-[11px] text-country-red" (click)="deleteRecording(recording)" title="Delete recording">×</button>
              </li>
            }
          </ul>
        }
        }
      </section>
      </div>
    </div>
  `,
})
export class DebugPanelComponent implements OnInit, OnDestroy {
  @Input({ required: true }) serviceId!: string;
  @Input({ required: true }) projectId!: string;

  private readonly debugService = inject(DebugService);
  private readonly projectService = inject(ProjectService);
  private readonly uiService = inject(UiService);

  readonly sparklineWidth = SPARKLINE_WIDTH;
  readonly sparklineMidline = SPARKLINE_HEIGHT / 2;
  readonly sparklineViewBox = `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`;

  exprInput = signal('');
  intervalInput = signal(500);
  modeInput = signal<'interval' | 'onChange'>('interval');
  threadInput = signal('');
  labelInput = signal('');
  conditionInput = signal('');
  groupInput = signal('');
  recordingNameInput = signal('');
  recordingIncludeLogs = signal(true);
  recordingIncludeMetrics = signal(true);
  recordingIncludeStatus = signal(true);
  autoIntervalMs = signal(1000);
  autoMaxSnapshots = signal(100);
  autoFrameDepth = signal(3);
  autoIncludeUserGlobals = signal(true);
  autoIncludeClosures = signal(true);
  autoExcludeRegex = signal('(?:node_modules|^internal/|^node:internal/)');
  private recordingTick = signal(0);
  selectedPresetId = signal('');
  isDragOver = signal(false);
  importMessage = signal<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // ── Progressive-disclosure UI state ─────────────────────────────────────
  // The panel packs a lot in; these keep the secondary controls folded away
  // by default so the everyday flow (enable → add watch → read values) stays
  // uncluttered. None of them touch server state.
  showAdvancedWatch = signal(false);
  showAutoRecord = signal(false);
  recordingsOpen = signal(false);
  // ── Recording player state ──────────────────────────────────────────────
  playerRecording = signal<DebugRecording | null>(null);
  playerPlayheadMs = signal(0);
  playerPlaying = signal(false);
  playerSpeed = signal<PlayerSpeed>(1);
  private playerTickHandle: ReturnType<typeof setInterval> | null = null;

  readonly panelState = computed(() => this.debugService.snapshot(this.serviceId));
  readonly project = computed(() => this.projectService.getProjectById(this.projectId));
  readonly service = computed(() => this.project()?.services.find((entry) => entry.id === this.serviceId) ?? null);
  readonly session = computed(() => this.panelState().session);
  readonly watchRows = computed(() => this.debugService.buildWatchRows(this.serviceId));
  readonly groupBySource = computed(() => this.panelState().ui.groupBySource);
  readonly debugEnabled = computed(() => Boolean(this.service()?.debug?.enabled));
  readonly persistWatchesEnabled = computed(() => Boolean(this.service()?.persistDebugWatches));

  readonly availablePresets = computed<DebugWatchPreset[]>(() => {
    const language: DebugLanguage | null = this.session().language;
    // Always show every preset. When the runtime language is known we sort
    // matching ones first so the most relevant choice is at the top of the
    // dropdown; before attach (`language === null`) we keep the declared
    // order so the user can still pre-select a template before starting.
    if (!language) return [...DEBUG_WATCH_PRESETS];
    return [...DEBUG_WATCH_PRESETS].sort((a, b) => {
      const aMatch = a.languages.length === 0 || a.languages.includes(language);
      const bMatch = b.languages.length === 0 || b.languages.includes(language);
      if (aMatch === bMatch) return 0;
      return aMatch ? -1 : 1;
    });
  });

  presetLabel(preset: DebugWatchPreset): string {
    if (preset.languages.length === 0) return `${preset.name} · any`;
    return `${preset.name} · ${preset.languages.join(', ')}`;
  }
  readonly activeRecording = computed(() => this.panelState().recordings.active);
  readonly finishedRecordings = computed(() => this.panelState().recordings.finished);
  readonly canStartRecording = computed(() => this.session().status === 'attached');
  readonly recordingDurationLabel = computed(() => {
    const active = this.activeRecording();
    if (!active) return '';
    // Re-evaluate every second by reading the tick signal.
    this.recordingTick();
    const ms = Date.now() - active.startedAt;
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  });

  private recordingTickHandle: ReturnType<typeof setInterval> | null = null;
  readonly canExportSession = computed(() => this.session().watches.length > 0);
  readonly isDetachedWhileRunning = computed(() => {
    const status = this.service()?.status;
    return this.session().status === 'detached' && (status === 'running' || status === 'restarting');
  });

  readonly statusClass = computed(() => {
    const status = this.session().status;
    if (status === 'attached') return 'border-country-green/40 text-country-green bg-country-green/10';
    if (status === 'error' || status === 'unsupported') return 'border-country-red/40 text-country-red bg-country-red/10';
    if (status === 'attaching') return 'border-country-yellow/40 text-country-yellow bg-country-yellow/10';
    return 'border-rustic-300 dark:border-rustic-600 text-rustic-500 dark:text-rustic-400 bg-rustic-100 dark:bg-rustic-700';
  });

  ngOnInit(): void {
    this.debugService.attach(this.serviceId);
    void this.debugService.refreshRecordings(this.serviceId).then(() => {
      // Auto-expand Recordings only when there is something to show, so the
      // section header stays collapsed on a fresh, empty session.
      if (this.activeRecording() || this.finishedRecordings().length > 0) {
        this.recordingsOpen.set(true);
      }
    });
    // Drives the live "X:XX" duration label without forcing the panel to
    // recompute every signal — the chip's text just reads `recordingTick`.
    this.recordingTickHandle = setInterval(() => this.recordingTick.update((n) => n + 1), 1000);
  }

  ngOnDestroy(): void {
    if (this.recordingTickHandle) clearInterval(this.recordingTickHandle);
    this.recordingTickHandle = null;
    this.stopPlayerTick();
    this.debugService.detach(this.serviceId);
  }

  /** Dismiss the panel — clears the UI debug target so the shell hides it. */
  close(): void {
    this.uiService.closeDebug();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  // ── Player computed/helpers ─────────────────────────────────────────────
  readonly playerDurationMs = computed(() => {
    const rec = this.playerRecording();
    if (!rec || rec.endedAt === undefined) return 0;
    return Math.max(0, rec.endedAt - rec.startedAt);
  });

  readonly playerSpeedOptions = PLAYER_SPEEDS;

  formatPlayhead(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const frac = String(Math.floor((ms % 1000) / 100));
    return `${mm}:${ss}.${frac}`;
  }

  metricsAtPlayhead() {
    const rec = this.playerRecording();
    if (!rec || !rec.metrics?.length) return null;
    const cutoff = rec.startedAt + this.playerPlayheadMs();
    let chosen = null;
    for (const m of rec.metrics) {
      if (m.measuredAt > cutoff) break;
      chosen = m;
    }
    return chosen;
  }

  logsUpToPlayhead() {
    const rec = this.playerRecording();
    if (!rec || !rec.logs?.length) return [];
    const cutoff = rec.startedAt + this.playerPlayheadMs();
    const out = [];
    for (const entry of rec.logs) {
      if (entry.t > cutoff) break;
      out.push(entry);
    }
    return out;
  }

  logsJoinedUpToPlayhead(): string {
    return this.logsUpToPlayhead()
      .map((entry) => entry.data)
      .join('')
      .replace(/\[[0-9;]*[A-Za-z]/g, ''); // strip ANSI for readable replay
  }

  /** Returns the latest sample on `track` whose timestamp is ≤ playhead. */
  valueAtPlayhead(track: DebugRecordingTrack): DebugSample | null {
    const rec = this.playerRecording();
    if (!rec) return null;
    const cutoff = rec.startedAt + this.playerPlayheadMs();
    let chosen: DebugSample | null = null;
    for (const sample of track.samples) {
      if (sample.t > cutoff) break;
      chosen = sample;
    }
    return chosen;
  }

  playerSparkline(track: DebugRecordingTrack): SparklineModel & { playheadX: number } {
    const rec = this.playerRecording();
    const empty = { kind: 'empty' as const, path: '', areaPath: '', dots: [], minLabel: '', maxLabel: '', playheadX: 0 };
    if (!rec) return empty;
    const samples = track.samples;
    if (samples.length === 0) return empty;

    const spanT = Math.max(1, (rec.endedAt ?? Date.now()) - rec.startedAt);
    const playheadX = SPARKLINE_PADDING + ((PLAYER_SPARKLINE_WIDTH - SPARKLINE_PADDING * 2) * this.playerPlayheadMs()) / spanT;

    const numericValues = samples
      .map((s) => (typeof s.value === 'number' && Number.isFinite(s.value) && !s.error ? s.value : null))
      .filter((v): v is number => v !== null);

    if (numericValues.length === samples.length && numericValues.length > 0) {
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);
      const span = max - min || 1;
      const points = samples.map((sample, index) => {
        const numeric = numericValues[index]!;
        const tNorm = (sample.t - rec.startedAt) / spanT;
        const x = SPARKLINE_PADDING + (PLAYER_SPARKLINE_WIDTH - SPARKLINE_PADDING * 2) * tNorm;
        const y = SPARKLINE_PADDING + (PLAYER_SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2) * (1 - (numeric - min) / span);
        return { x, y };
      });
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const areaPath = `${path} L ${last.x.toFixed(2)} ${(PLAYER_SPARKLINE_HEIGHT - SPARKLINE_PADDING).toFixed(2)} L ${first.x.toFixed(2)} ${(PLAYER_SPARKLINE_HEIGHT - SPARKLINE_PADDING).toFixed(2)} Z`;
      return {
        kind: 'numeric',
        path,
        areaPath,
        dots: [],
        minLabel: this.formatNumber(min),
        maxLabel: this.formatNumber(max),
        playheadX,
      };
    }

    const dots = samples.map((sample) => {
      const tNorm = (sample.t - rec.startedAt) / spanT;
      return {
        x: SPARKLINE_PADDING + (PLAYER_SPARKLINE_WIDTH - SPARKLINE_PADDING * 2) * tNorm,
        y: sample.error ? PLAYER_SPARKLINE_HEIGHT - 10 : PLAYER_SPARKLINE_HEIGHT / 2,
        error: Boolean(sample.error),
      };
    });
    return { kind: 'categorical', path: '', areaPath: '', dots, minLabel: 'start', maxLabel: 'end', playheadX };
  }

  readonly playerSparklineWidth = PLAYER_SPARKLINE_WIDTH;
  readonly playerSparklineHeight = PLAYER_SPARKLINE_HEIGHT;
  readonly playerSparklineViewBox = `0 0 ${PLAYER_SPARKLINE_WIDTH} ${PLAYER_SPARKLINE_HEIGHT}`;

  async openRecordingPlayer(recording: DebugRecordingSummary): Promise<void> {
    const full = await this.debugService.getRecording(this.serviceId, recording.id);
    if (!full) return;
    this.playerRecording.set(full);
    this.playerPlayheadMs.set(0);
    this.playerPlaying.set(false);
    this.stopPlayerTick();
  }

  closeRecordingPlayer(): void {
    this.playerRecording.set(null);
    this.playerPlaying.set(false);
    this.stopPlayerTick();
  }

  togglePlayerPlay(): void {
    if (!this.playerRecording()) return;
    if (this.playerPlaying()) {
      this.playerPlaying.set(false);
      this.stopPlayerTick();
      return;
    }
    if (this.playerPlayheadMs() >= this.playerDurationMs()) {
      this.playerPlayheadMs.set(0);
    }
    this.playerPlaying.set(true);
    this.playerTickHandle = setInterval(() => {
      const next = this.playerPlayheadMs() + PLAYER_TICK_MS * this.playerSpeed();
      const duration = this.playerDurationMs();
      if (next >= duration) {
        this.playerPlayheadMs.set(duration);
        this.playerPlaying.set(false);
        this.stopPlayerTick();
      } else {
        this.playerPlayheadMs.set(next);
      }
    }, PLAYER_TICK_MS);
  }

  setPlayerPlayhead(value: number | string): void {
    const ms = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(ms)) return;
    this.playerPlayheadMs.set(Math.max(0, Math.min(this.playerDurationMs(), ms)));
  }

  setPlayerSpeed(value: string | number): void {
    const speed = Number(value) as PlayerSpeed;
    if (PLAYER_SPEEDS.includes(speed)) this.playerSpeed.set(speed);
  }

  private stopPlayerTick(): void {
    if (this.playerTickHandle) {
      clearInterval(this.playerTickHandle);
      this.playerTickHandle = null;
    }
  }

  async toggleDebugFlag(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    await this.projectService.setServiceDebug(this.projectId, this.serviceId, enabled);
  }

  async togglePersistWatches(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    await this.projectService.setServicePersistDebugWatches(this.projectId, this.serviceId, enabled);
  }

  // ── Preset import / export / templates ─────────────────────────────────
  exportPreset(): void {
    const preset = this.debugService.presetFromWatches(this.session().watches);
    if (preset.length === 0) {
      this.importMessage.set({ tone: 'error', text: 'No watches to export.' });
      return;
    }
    const payload = {
      service: this.service()?.name ?? this.serviceId,
      exportedAt: new Date().toISOString(),
      watches: preset,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const filename = `${(this.service()?.name ?? this.serviceId).replace(/[^A-Za-z0-9_.-]+/g, '_')}-watches.json`;
    this.downloadBlob(blob, filename);
    this.importMessage.set({ tone: 'ok', text: `Exported ${preset.length} watches.` });
  }

  async applyPreset(): Promise<void> {
    const id = this.selectedPresetId();
    if (!id) return;
    const preset = DEBUG_WATCH_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const result = await this.debugService.addWatchesBulk(this.serviceId, preset.watches);
    if (!result) {
      this.importMessage.set({ tone: 'error', text: `Failed to apply template "${preset.name}".` });
      return;
    }
    this.importMessage.set({
      tone: result.failed.length === 0 ? 'ok' : 'error',
      text:
        result.failed.length === 0
          ? `Applied "${preset.name}" — added ${result.added.length} watches.`
          : `Applied "${preset.name}" — added ${result.added.length}, ${result.failed.length} failed.`,
    });
    this.selectedPresetId.set('');
  }

  async onPresetFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.importPresetFile(file);
    input.value = '';
  }

  onPresetDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.isDragOver.set(true);
  }

  onPresetDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  async onPresetDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.importPresetFile(file);
  }

  private async importPresetFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      this.importMessage.set({ tone: 'error', text: 'Could not read file.' });
      return;
    }

    let watches: CreateDebugWatchBody[];
    try {
      const parsed = JSON.parse(text) as unknown;
      // Accept either the export shape `{watches: [...]}` or a bare array.
      const candidate = Array.isArray(parsed)
        ? parsed
        : ((parsed as { watches?: unknown }).watches ?? []);
      if (!Array.isArray(candidate)) {
        throw new Error('Expected an array of watches');
      }
      watches = candidate
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => {
          const expr = entry['expr'];
          if (typeof expr !== 'string' || expr.trim().length === 0) {
            throw new Error('Each watch needs a non-empty `expr` string');
          }
          const body: CreateDebugWatchBody = { expr };
          const optString = (key: string) => {
            const v = entry[key];
            if (typeof v === 'string' && v.trim().length > 0) return v.trim();
            return undefined;
          };
          const optNumber = (key: string) => {
            const v = entry[key];
            return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
          };
          const mode = entry['mode'];
          if (mode === 'interval' || mode === 'onChange') body.mode = mode;
          const intervalMs = optNumber('intervalMs');
          if (intervalMs !== undefined) body.intervalMs = intervalMs;
          const bufferSize = optNumber('bufferSize');
          if (bufferSize !== undefined) body.bufferSize = bufferSize;
          const threadName = optString('threadName');
          if (threadName) body.threadName = threadName;
          const label = optString('label');
          if (label) body.label = label;
          const condition = optString('condition');
          if (condition) body.condition = condition;
          const groupName = optString('groupName');
          if (groupName) body.groupName = groupName;
          return body;
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      this.importMessage.set({ tone: 'error', text: `Import failed: ${message}` });
      return;
    }

    if (watches.length === 0) {
      this.importMessage.set({ tone: 'error', text: 'No watches found in file.' });
      return;
    }

    const result = await this.debugService.addWatchesBulk(this.serviceId, watches);
    if (!result) {
      this.importMessage.set({ tone: 'error', text: 'Bulk import request failed.' });
      return;
    }
    this.importMessage.set({
      tone: result.failed.length === 0 ? 'ok' : 'error',
      text:
        result.failed.length === 0
          ? `Imported ${result.added.length} watches from ${file.name}.`
          : `Imported ${result.added.length} of ${watches.length} (${result.failed.length} failed).`,
    });
  }

  async toggleRecording(): Promise<void> {
    const active = this.activeRecording();
    if (active) {
      await this.debugService.stopRecording(this.serviceId, active.id);
      return;
    }
    if (!this.canStartRecording()) return;
    const name = this.recordingNameInput().trim();
    await this.debugService.startRecording(this.serviceId, {
      name: name || undefined,
      includeLogs: this.recordingIncludeLogs(),
      includeMetrics: this.recordingIncludeMetrics(),
      includeStatus: this.recordingIncludeStatus(),
    });
    this.recordingNameInput.set('');
  }

  async startAutoRecording(): Promise<void> {
    if (this.activeRecording()) return;
    if (!this.canStartRecording()) return;
    const opts: AutoRecordingOptions = {
      name: this.recordingNameInput().trim() || undefined,
      autoIntervalMs: Number(this.autoIntervalMs()) || 1000,
      autoMaxSnapshots: Number(this.autoMaxSnapshots()) || 100,
      autoFrameDepth: Number(this.autoFrameDepth()) || 3,
      includeUserGlobals: this.autoIncludeUserGlobals(),
      includeClosures: this.autoIncludeClosures(),
      excludeFrameRegex: this.autoExcludeRegex().trim() || undefined,
    };
    await this.debugService.startAutoRecording(this.serviceId, opts);
    this.recordingNameInput.set('');
  }

  nearestSnapshot(recording: DebugRecording) {
    const snapshots = recording.snapshots ?? [];
    if (snapshots.length === 0) return null;
    const cutoff = recording.startedAt + this.playerPlayheadMs();
    let chosen = snapshots[0] ?? null;
    for (const snap of snapshots) {
      if (snap.t > cutoff) break;
      chosen = snap;
    }
    return chosen;
  }

  async exportRecording(recording: DebugRecordingSummary, format: DebugHistoryExportFormat): Promise<void> {
    const result = await this.debugService.exportRecording(this.serviceId, recording, format);
    if (!result) return;
    this.downloadBlob(result.blob, result.filename);
  }

  async deleteRecording(recording: DebugRecordingSummary): Promise<void> {
    await this.debugService.deleteRecording(this.serviceId, recording.id);
  }

  toggleGroupBySource(): void {
    this.debugService.setGroupBySource(this.serviceId, !this.groupBySource());
  }

  watchUi(watchId: string): DebugWatchUiState {
    return this.debugService.watchUiState(this.serviceId, watchId);
  }

  historyOf(watchId: string): DebugSample[] {
    return this.debugService.viewHistory(this.serviceId, watchId);
  }

  latest(watchId: string): DebugSample | undefined {
    const history = this.historyOf(watchId);
    return history[history.length - 1];
  }

  historyRows(watchId: string): HistoryRow[] {
    const samples = this.historyOf(watchId);
    return samples.map((sample, index) => {
      const previous = index > 0 ? samples[index - 1] : undefined;
      const diff = this.describeDiff(previous, sample);
      return {
        key: `${sample.t}-${index}`,
        timestamp: this.formatTimestamp(sample.t),
        value: sample.error ? `err: ${sample.error}` : this.formatValue(sample.value),
        diff: diff.text,
        changed: diff.changed,
        error: Boolean(sample.error),
      };
    });
  }

  sparklineLabel(watchId: string): string {
    const sparkline = this.sparklineFor(watchId);
    if (sparkline.kind === 'numeric') {
      return `${sparkline.minLabel} → ${sparkline.maxLabel}`;
    }
    if (sparkline.kind === 'categorical') {
      return 'event trail';
    }
    return 'waiting';
  }

  sparklineFor(watchId: string): SparklineModel {
    const samples = this.historyOf(watchId);
    if (samples.length === 0) {
      return { kind: 'empty', path: '', areaPath: '', dots: [], minLabel: '', maxLabel: '' };
    }

    const numericValues = samples
      .map((sample) => (typeof sample.value === 'number' && Number.isFinite(sample.value) && !sample.error ? sample.value : null))
      .filter((value): value is number => value !== null);

    if (numericValues.length === samples.length) {
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);
      const span = max - min || 1;
      const step = samples.length > 1 ? (SPARKLINE_WIDTH - SPARKLINE_PADDING * 2) / (samples.length - 1) : 0;
      const points = numericValues.map((value, index) => {
        const x = SPARKLINE_PADDING + step * index;
        const y = SPARKLINE_PADDING + (SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2) * (1 - (value - min) / span);
        return { x, y };
      });

      const path = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');

      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last) {
        return { kind: 'empty', path: '', areaPath: '', dots: [], minLabel: '', maxLabel: '' };
      }
      const areaPath = `${path} L ${last.x.toFixed(2)} ${(SPARKLINE_HEIGHT - SPARKLINE_PADDING).toFixed(2)} L ${first.x.toFixed(2)} ${(SPARKLINE_HEIGHT - SPARKLINE_PADDING).toFixed(2)} Z`;

      return {
        kind: 'numeric',
        path,
        areaPath,
        dots: [],
        minLabel: this.formatNumber(min),
        maxLabel: this.formatNumber(max),
      };
    }

    const step = samples.length > 1 ? (SPARKLINE_WIDTH - SPARKLINE_PADDING * 2) / (samples.length - 1) : 0;
    const dots = samples.map((sample, index) => ({
      x: SPARKLINE_PADDING + step * index,
      y: sample.error ? SPARKLINE_HEIGHT - 10 : SPARKLINE_HEIGHT / 2,
      error: Boolean(sample.error),
    }));

    return {
      kind: 'categorical',
      path: '',
      areaPath: '',
      dots,
      minLabel: 'older',
      maxLabel: 'newer',
    };
  }

  formatValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, typeof value === 'object' ? 2 : 0);
    } catch {
      return String(value);
    }
  }

  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  async submitWatch(): Promise<void> {
    const expr = this.exprInput().trim();
    if (!expr) return;

    const mode = this.modeInput();
    const intervalMs = Number(this.intervalInput()) || 500;
    const threadName = this.threadInput().trim();
    const label = this.labelInput().trim();
    const condition = this.conditionInput().trim();
    const groupName = this.groupInput().trim();
    await this.debugService.addWatch(this.serviceId, {
      expr,
      intervalMs,
      mode,
      ...(threadName ? { threadName } : {}),
      ...(label ? { label } : {}),
      ...(condition ? { condition } : {}),
      ...(groupName ? { groupName } : {}),
    });
    this.exprInput.set('');
    this.threadInput.set('');
    this.labelInput.set('');
    this.conditionInput.set('');
    this.groupInput.set('');
  }

  async remove(watchId: string): Promise<void> {
    await this.debugService.removeWatch(this.serviceId, watchId);
  }

  togglePause(watchId: string): void {
    this.debugService.toggleWatchPaused(this.serviceId, watchId);
  }

  toggleHistory(watchId: string): void {
    this.debugService.toggleWatchHistory(this.serviceId, watchId);
  }

  setExportFrom(watchId: string, value: string): void {
    this.debugService.setWatchExportRange(this.serviceId, watchId, { exportFrom: value });
  }

  setExportTo(watchId: string, value: string): void {
    this.debugService.setWatchExportRange(this.serviceId, watchId, { exportTo: value });
  }

  resetExportRange(watchId: string): void {
    const history = this.historyOf(watchId);
    if (history.length === 0) {
      this.debugService.setWatchExportRange(this.serviceId, watchId, { exportFrom: '', exportTo: '' });
      return;
    }

    const first = history[0];
    const last = history[history.length - 1];
    if (!first || !last) {
      return;
    }

    this.debugService.setWatchExportRange(this.serviceId, watchId, {
      exportFrom: this.toDatetimeLocal(first.t),
      exportTo: this.toDatetimeLocal(last.t),
    });
  }

  drop(event: CdkDragDrop<DebugPanelRow[]>): void {
    const watchIds = this.debugService.orderedWatchIds(this.serviceId);
    moveItemInArray(watchIds, event.previousIndex, event.currentIndex);
    this.debugService.reorderWatches(this.serviceId, watchIds);
  }

  async restartNow(): Promise<void> {
    await this.projectService.restartService(this.projectId, this.serviceId);
  }

  async copyWatchJson(watchId: string): Promise<void> {
    const payload = this.debugService.createWatchJson(this.serviceId, watchId);
    if (!payload) {
      this.uiService.showToast('Copy failed', 'The selected watch no longer exists.', 'error');
      return;
    }

    const watch = this.session().watches.find((entry) => entry.id === watchId);
    await this.copyText(payload, 'Watch copied', `${watch?.expr ?? 'Watch'} JSON is ready to paste.`);
  }

  async exportSession(): Promise<void> {
    const project = this.project();
    const service = this.service();

    if (!project || !service) {
      this.uiService.showToast('Export failed', 'The service metadata is not available yet.', 'error');
      return;
    }

    const payload = this.debugService.createSessionExport(this.serviceId, {
      projectId: project.id,
      projectName: project.name,
      serviceName: service.name,
      serviceStatus: service.status,
      serviceCommand: service.command,
      serviceCwd: service.cwd,
    });

    this.downloadText(payload, `${this.sanitiseFilename(project.name)}-${this.sanitiseFilename(service.name)}-debug-session.json`);
    this.uiService.showToast('Session exported', `${service.name} debug session JSON has been downloaded.`);
  }

  async exportWatch(watch: DebugWatch, format: DebugHistoryExportFormat): Promise<void> {
    const range = this.resolveWatchRange(watch.id);
    if (!range) {
      return;
    }

    try {
      const blob = await this.debugService.exportWatchHistoryRange(this.serviceId, watch.id, {
        from: range.from,
        to: range.to,
        format,
      });
      this.downloadBlob(blob, `${this.buildWatchFilename(watch)}.${format}`);
      this.uiService.showToast('Watch exported', `${watch.expr} ${format.toUpperCase()} export is ready.`);
    } catch (error) {
      console.error('Error exporting watch history:', error);
      this.uiService.showToast(
        'Export failed',
        error instanceof Error ? error.message : 'The watch range could not be exported.',
        'error',
      );
    }
  }

  private describeDiff(previous: DebugSample | undefined, current: DebugSample): { text: string; changed: boolean } {
    if (!previous) {
      return { text: '—', changed: false };
    }

    if (previous.error || current.error) {
      if (previous.error === current.error) {
        return { text: previous.error ? 'same error' : 'same', changed: false };
      }
      if (current.error) {
        return { text: 'error', changed: true };
      }
      return { text: 'recovered', changed: true };
    }

    const previousNumber = this.asFiniteNumber(previous.value);
    const currentNumber = this.asFiniteNumber(current.value);
    if (previousNumber !== null && currentNumber !== null) {
      const delta = currentNumber - previousNumber;
      return {
        text: delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${this.formatNumber(delta)}`,
        changed: delta !== 0,
      };
    }

    const previousValue = this.serialiseForCompare(previous.value);
    const currentValue = this.serialiseForCompare(current.value);
    return previousValue === currentValue
      ? { text: 'same', changed: false }
      : { text: 'changed', changed: true };
  }

  private asFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private formatNumber(value: number): string {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value
      .toFixed(Math.abs(value) >= 10 ? 2 : 3)
      .replace(/(\.\d*?[1-9])0+$/, '$1')
      .replace(/\.0+$/, '');
  }

  private serialiseForCompare(value: unknown): string {
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }

  private resolveWatchRange(watchId: string): { from: number; to: number } | null {
    const ui = this.watchUi(watchId);
    const fromInput = ui.exportFrom || this.deriveRangeBound(watchId, 'from');
    const toInput = ui.exportTo || this.deriveRangeBound(watchId, 'to');

    if (!fromInput || !toInput) {
      this.uiService.showToast('Export failed', 'This watch needs at least one retained sample before it can export a range.', 'error');
      return null;
    }

    const from = new Date(fromInput).getTime();
    const to = new Date(toInput).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      this.uiService.showToast('Export failed', 'Please choose a valid From/To range before exporting.', 'error');
      return null;
    }
    if (from > to) {
      this.uiService.showToast('Export failed', 'The export start time must be earlier than the end time.', 'error');
      return null;
    }

    return { from, to };
  }

  private deriveRangeBound(watchId: string, bound: 'from' | 'to'): string {
    const history = this.historyOf(watchId);
    if (history.length === 0) {
      return '';
    }
    const first = history[0];
    const last = history[history.length - 1];
    if (!first || !last) {
      return '';
    }

    return bound === 'from'
      ? this.toDatetimeLocal(first.t)
      : this.toDatetimeLocal(last.t);
  }

  private toDatetimeLocal(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private buildWatchFilename(watch: DebugWatch): string {
    const serviceName = this.service()?.name ?? 'service';
    return `${this.sanitiseFilename(serviceName)}-${this.sanitiseFilename(this.debugService.deriveSource(watch.expr))}-${this.sanitiseFilename(watch.expr)}-history`;
  }

  private sanitiseFilename(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'watch';
  }

  private async copyText(text: string, successTitle: string, successMessage: string): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!this.copyWithFallback(text)) {
        throw new Error('Clipboard API unavailable');
      }
      this.uiService.showToast(successTitle, successMessage);
    } catch (error) {
      console.error('Error copying debug payload:', error);
      this.uiService.showToast('Copy failed', 'The browser could not copy the debug payload.', 'error');
    }
  }

  private copyWithFallback(text: string): boolean {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  }

  private downloadText(text: string, filename: string): void {
    this.downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    if (typeof document === 'undefined') {
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}
