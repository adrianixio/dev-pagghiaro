import type { HttpExchange } from '@dev-pagghiaro/shared';

export const HTTP_CAPTURE_MAX = 200;

const byService = new Map<string, HttpExchange[]>();

export const httpCaptureStore = {
  add(exchange: HttpExchange): void {
    const arr = byService.get(exchange.serviceId) ?? [];
    arr.push(exchange);
    if (arr.length > HTTP_CAPTURE_MAX) arr.shift();
    byService.set(exchange.serviceId, arr);
  },
  query(serviceId: string): HttpExchange[] {
    return [...(byService.get(serviceId) ?? [])];
  },
  clear(serviceId: string): void {
    byService.delete(serviceId);
  },
  reset(): void {
    byService.clear();
  },
};
