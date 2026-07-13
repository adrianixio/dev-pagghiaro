export async function fetchInspectorWsUrl(port: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!res.ok) return null;
    const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string }>;
    return targets[0]?.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
