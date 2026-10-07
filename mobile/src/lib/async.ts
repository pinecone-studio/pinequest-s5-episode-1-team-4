export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `ms` дотор дуусаагүй бол `message`-тэй алдаа өгнө — камер гацахад давталт зогсохгүй. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
