import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  ArrowDownToLine,
  Bug,
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  Folder,
  FolderPlus,
  GripVertical,
  HardDrive,
  ListOrdered,
  LucideAngularModule,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Pin,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ScrollText,
  Search,
  Server,
  Settings,
  Square,
  Sun,
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
        Activity, ArrowDownToLine, ArrowLeftRight, ArrowRight, Bug, ChevronDown, ChevronRight, Columns2, ExternalLink, Folder, FolderPlus, GripVertical, HardDrive, ListOrdered, Maximize2, Menu, Minimize2, Moon, Pin, Play, PlugZap, Plus, RefreshCw, RotateCw, Save, ScrollText, Search, Server, Settings, Square, Sun, Terminal, Trash2, X
      })
    )
  ]
};
