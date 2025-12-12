/**
 * AsyncLock - Thread-safe locking mechanism for async operations
 * Prevents race conditions when multiple async operations try to access shared resources
 */

export class AsyncLock {
  private queue: Promise<void> = Promise.resolve();
  private locked = false;

  /**
   * Check if the lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Acquire the lock and execute a function
   * Queues requests if lock is already held
   * @param fn - Async function to execute while holding the lock
   * @returns Promise with the result of fn
   */
  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    const release = this.queue;
    let resolve: () => void;
    this.queue = new Promise((r) => (resolve = r));

    await release;
    this.locked = true;

    try {
      return await fn();
    } finally {
      this.locked = false;
      resolve!();
    }
  }

  /**
   * Try to acquire the lock without waiting
   * Returns null if lock is already held
   * @param fn - Async function to execute while holding the lock
   * @returns Promise with result or null if lock is held
   */
  async tryAcquire<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.locked) {
      return null;
    }
    return this.acquire(fn);
  }
}

/**
 * Named lock manager for multiple independent locks
 */
export class LockManager {
  private locks = new Map<string, AsyncLock>();

  /**
   * Get or create a lock by name
   */
  getLock(name: string): AsyncLock {
    let lock = this.locks.get(name);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(name, lock);
    }
    return lock;
  }

  /**
   * Check if a named lock is currently held
   */
  isLocked(name: string): boolean {
    const lock = this.locks.get(name);
    return lock ? lock.isLocked() : false;
  }

  /**
   * Acquire a named lock and execute a function
   */
  async acquire<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.getLock(name).acquire(fn);
  }

  /**
   * Try to acquire a named lock without waiting
   */
  async tryAcquire<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    return this.getLock(name).tryAcquire(fn);
  }
}

// Global lock instances for common operations
export const saveLock = new AsyncLock();
export const databaseLock = new AsyncLock();
export const gpsLock = new AsyncLock();

// Global lock manager for dynamic locks
export const lockManager = new LockManager();
