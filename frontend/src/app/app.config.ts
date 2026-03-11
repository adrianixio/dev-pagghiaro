import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { LucideAngularModule, Folder, Settings, Terminal, Activity, Play, Square, Server, Cpu, HardDrive, Trash2, ArrowDownToLine, X, Search, Save, RefreshCw } from 'lucide-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    importProvidersFrom(
      LucideAngularModule.pick({
        Folder, Settings, Terminal, Activity, Play, Square, Server, Cpu, HardDrive, Trash2, ArrowDownToLine, X, Search, Save, RefreshCw
      })
    )
  ]
};
