// The API intentionally runs as one PM2 process. Database compare-and-set still
// guards terminal decisions; these locks also serialize registrar nonces/workflows.
const queues = new Map<string, Promise<unknown>>();
export async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(key, next);
  try { return await next; }
  finally { if (queues.get(key) === next) queues.delete(key); }
}
