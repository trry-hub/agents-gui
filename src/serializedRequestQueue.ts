export class SerializedRequestQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(
    key: string,
    operation: () => Promise<void>,
    onError: (error: unknown) => void
  ): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const handled = previous.then(operation).catch((error) => {
      try {
        onError(error);
      } catch {
        // Reporting must never poison the serialization tail.
      }
    });
    const tail = handled.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(key, tail);
    return handled.finally(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
  }
}
