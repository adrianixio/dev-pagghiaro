import { ProjectConfig, ServiceConfig, ServiceStatus, ServiceMetrics as SharedServiceMetrics } from '@dev-pagghiaro/shared';

export type { ProjectConfig, ServiceConfig, ServiceStatus };

export interface ServiceMetrics {
  cpu: number; // percentage
  ram: number; // MB
}

export interface UiService extends ServiceConfig {
  status: ServiceStatus;
  metrics?: ServiceMetrics;
}

export interface UiProject extends ProjectConfig {
  services: UiService[];
}

export interface LogMessage {
  serviceId: string;
  projectId: string;
  timestamp: number;
  data: string;
  type: 'stdout' | 'stderr' | 'system';
}
