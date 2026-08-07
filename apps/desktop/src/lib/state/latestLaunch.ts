export interface LaunchValue<T> {
  value: T;
  newlyCreated: boolean;
}

type DiscardSuperseded<T> = (value: T) => void | Promise<void>;

export class LatestLaunch {
  #token = 0;

  invalidate(): void {
    this.#token += 1;
  }

  run<T>(
    newlyCreated: true,
    load: () => Promise<T | null>,
    apply: (launch: LaunchValue<T>) => void,
    discardSuperseded: DiscardSuperseded<T>,
  ): Promise<void>;
  run<T>(
    newlyCreated: false,
    load: () => Promise<T | null>,
    apply: (launch: LaunchValue<T>) => void,
  ): Promise<void>;
  async run<T>(
    newlyCreated: boolean,
    load: () => Promise<T | null>,
    apply: (launch: LaunchValue<T>) => void,
    discardSuperseded?: DiscardSuperseded<T>,
  ): Promise<void> {
    const token = ++this.#token;
    const value = await load();
    if (value === null) return;
    if (token !== this.#token) {
      await discardSuperseded?.(value);
      return;
    }
    apply({ value, newlyCreated });
  }
}
