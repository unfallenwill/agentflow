/**
 * Counting semaphore for limiting concurrent async operations.
 *
 * Each `acquire()` returns a one-shot release function — calling it
 * more than once is a safe no-op rather than corrupting internal state.
 *
 * @example
 * const sem = new Semaphore(5);
 * const release = await sem.acquire();
 * try { await doWork(); }
 * finally { release(); }
 */
export class Semaphore {
  private running = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {
    if (max < 1) {
      throw new RangeError(`Semaphore maxConcurrency must be >= 1, got ${max}`)
    }
  }

  /** Maximum number of concurrent holders this semaphore allows. */
  get capacity(): number {
    return this.max
  }

  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running++
      return this.oneShotRelease()
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.running++
        resolve(this.oneShotRelease())
      })
    })
  }

  /** Create a one-shot release function that guards against double-release. */
  private oneShotRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.release()
    }
  }

  private release(): void {
    if (this.running <= 0) {
      throw new Error('Semaphore: release() called with no active holders')
    }
    this.running--
    const next = this.queue.shift()
    if (next !== undefined) next()
  }
}
