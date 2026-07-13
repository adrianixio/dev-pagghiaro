export const DEBUG_DEFAULT_PORT = 9229;

export function buildDebugNodeOptions(existing: string | undefined, port: number): string {
  const flag = `--inspect=127.0.0.1:${port}`;
  const trimmed = (existing ?? '').trim();
  return trimmed ? `${trimmed} ${flag}` : flag;
}
