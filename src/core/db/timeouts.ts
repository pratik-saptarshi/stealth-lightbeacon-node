export const DEFAULT_DB_TIMEOUT_MS = 2000;

export class DbTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, label = 'DB operation') {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'DbTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface HardTimeoutOptions {
  readonly timeoutMs?: number;
  readonly label?: string;
  readonly signal?: AbortSignal;
}

function toAbortError(label: string, reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  return new Error(`${label} aborted`);
}

export async function withHardTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T> | T,
  options: HardTimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DB_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }

  const label = options.label ?? 'DB operation';
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const operationPromise = Promise.resolve().then(() => operation(controller.signal));

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new DbTimeoutError(timeoutMs, label);
      controller.abort(error);
      reject(error);
    }, timeoutMs);

    if (typeof timeoutId !== 'number') {
      timeoutId.unref();
    }
  });

  const abortPromise = externalSignal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => {
          const error = toAbortError(label, externalSignal.reason);
          controller.abort(error);
          reject(error);
        };

        if (externalSignal.aborted) {
          onAbort();
          return;
        }

        externalSignal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
      })
    : null;

  try {
    const race = abortPromise
      ? Promise.race([operationPromise, timeoutPromise, abortPromise])
      : Promise.race([operationPromise, timeoutPromise]);

    return await race;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    removeAbortListener?.();
  }
}
