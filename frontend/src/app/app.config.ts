import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  Activity,
  ArrowDownToLine,
  Folder,
  HardDrive,
  LucideAngularModule,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sun,
  Moon,
  Server,
  Settings,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    importProvidersFrom(
      LucideAngularModule.pick({
        Folder, Settings, Terminal, Activity, Play, Square, Server, HardDrive, Trash2, ArrowDownToLine, X, Search, Save, RefreshCw, Plus, Sun, Moon
      })
    )
  ]
};
