export interface LaunchValue<T> {
  value: T;
  newlyCreated: boolean;
}

export class LatestLaunch {
  #token = 0;

  invalidate(): void {
    this.#token += 1;
  }

  async run<T>(
    newlyCreated: boolean,
    load: () => Promise<T | null>,
    apply: (launch: LaunchValue<T>) => void,
  ): Promise<void> {
    const token = ++this.#token;
    const value = await load();
    if (token !== this.#token || value === null) return;
    apply({ value, newlyCreated });
  }
}
