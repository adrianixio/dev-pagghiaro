import type { HttpCapturedBody, HttpHeader } from '@dev-pagghiaro/shared';

export const HTTP_BODY_CAP_BYTES = 64 * 1024;

const TEXTUAL = /^(text\/[a-z0-9.+-]*|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|application\/[a-z0-9.+-]*\+(json|xml))$/i;

export function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  return TEXTUAL.test(essence);
}

export function captureBody(contentType: string | null, bytes: Uint8Array): HttpCapturedBody | undefined {
  if (bytes.length === 0) return undefined;
  const byteLength = bytes.length;
  if (!isTextualContentType(contentType)) {
    return { binary: true, byteLength };
  }
  const truncated = byteLength > HTTP_BODY_CAP_BYTES;
  const slice = truncated ? bytes.subarray(0, HTTP_BODY_CAP_BYTES) : bytes;
  const text = new TextDecoder().decode(slice);
  return { text, byteLength, ...(truncated ? { truncated: true } : {}) };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export function stripHopByHop(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const h of HOP_BY_HOP) out.delete(h);
  return out;
}

export function toHeaderRecords(headers: Headers): HttpHeader[] {
  const out: HttpHeader[] = [];
  headers.forEach((value, name) => out.push({ name, value }));
  return out;
}
