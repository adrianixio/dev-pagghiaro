import { Injectable, signal } from '@angular/core';
import { AppMetadata } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

@Injectable({
  providedIn: 'root',
})
export class AppMetadataService {
  private readonly metadataSignal = signal<AppMetadata | null>(null);
  readonly metadata = this.metadataSignal.asReadonly();

  constructor() {
    void this.loadMetadata();
  }

  private async loadMetadata(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/meta`);
      if (!response.ok) {
        return;
      }
      const metadata = (await response.json()) as AppMetadata;
      this.metadataSignal.set(metadata);
    } catch (error) {
      console.error('Error loading app metadata:', error);
    }
  }
}
