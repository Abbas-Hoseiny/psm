type EventHandler<T = any> = (payload: T) => void;

const subscribers = new Map<string, Map<string, EventHandler>>();
let counter = 0;

export function subscribe<T = any>(
  eventName: string,
  handler: EventHandler<T>
): () => void {
  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, new Map());
  }
  const token = `h_${eventName}_${counter++}`;
  subscribers.get(eventName)!.set(token, handler);
  return () => {
    const handlers = subscribers.get(eventName);
    if (handlers) {
      handlers.delete(token);
      if (!handlers.size) {
        subscribers.delete(eventName);
      }
    }
  };
}

export function emit<T = any>(eventName: string, payload?: T): void {
  const handlers = subscribers.get(eventName);
  if (!handlers) {
    return;
  }
  for (const handler of handlers.values()) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`eventBus handler error for ${eventName}`, err);
    }
  }
}

export function clearEventBus(): void {
  subscribers.clear();
  counter = 0;
}
