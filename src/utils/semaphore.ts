/**
 * Counting semaphore for limiting concurrent async operations.
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

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running++
      return this.release.bind(this)
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.running++
        resolve(this.release.bind(this))
      })
    })
  }

  private release(): void {
    this.running--
    const next = this.queue.shift()
    if (next !== undefined) next()
  }
}
