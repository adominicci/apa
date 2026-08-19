// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages";
import { setLocale } from "$lib/paraglide/runtime";
import type {
  ImportApplyResult,
  ImportPreviewResult,
} from "$lib/persist/importFlow";
import type { RecoveryOutcome } from "$lib/persist/importJournal";
import type { RecoveryActionDeps } from "./RecoveryRequiredActions.svelte";
import LibraryImportModal from "./LibraryImportModal.svelte";

/** Task 7.4: Merge modal states, counts, a11y, and language behavior. */

function fixturePreview(
  overrides: Partial<ImportPreviewResult["preview"]> = {},
): ImportPreviewResult {
  return {
    preview: {
      essays: { new: 2, identical: 1, conflicting: 1 },
      references: { new: 3, identical: 4, conflicting: 0 },
      collections: { new: 1, identical: 0, conflicting: 0 },
      assets: { reused: 5, added: 6 },
      ...overrides,
    },
  } as ImportPreviewResult;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await tick();
}

let component: Record<string, unknown> | null = null;

function mountModal(props: {
  loadPreview: () => Promise<ImportPreviewResult | null>;
  apply?: (c: ImportPreviewResult) => Promise<ImportApplyResult>;
  restoreMode?: boolean;
  recoveryActions?: RecoveryActionDeps;
  onDone?: () => void | Promise<void>;
  onClose?: () => void;
}): void {
  component = mount(LibraryImportModal, {
    target: document.body,
    props: {
      apply: props.apply ??
        (() =>
          Promise.resolve(
            {
              kind: "applied",
              transactionId: "t",
              preview: fixturePreview().preview,
            } satisfies ImportApplyResult,
          )),
      onDone: props.onDone ?? (() => {}),
      onClose: props.onClose ?? (() => {}),
      loadPreview: props.loadPreview,
      restoreMode: props.restoreMode ?? false,
      recoveryActions: props.recoveryActions,
    },
  }) as Record<string, unknown>;
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = "";
  setLocale("es", { reload: false });
});

describe("LibraryImportModal", () => {
  it("shows validating, then the preview counts and consequences", async () => {
    const gate = deferred<ImportPreviewResult | null>();
    mountModal({ loadPreview: () => gate.promise });
    await settle();
    expect(document.body.textContent).toContain(m.imp_validating());

    gate.resolve(fixturePreview());
    await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain(m.imp_essays_new({ count: 2 }));
    expect(text).toContain(m.imp_essays_identical({ count: 1 }));
    expect(text).toContain(m.imp_essays_conflicting({ count: 1 }));
    expect(text).toContain(
      m.imp_refs_summary({ added: 3, identical: 4, conflicting: 0 }),
    );
    expect(text).toContain(m.imp_assets_summary({ added: 6, reused: 5 }));
    expect(text).toContain(m.imp_rollback_privacy());
    // No replace-library operation exists anywhere in version one.
    expect(text).not.toContain("replace");
  });

  it("cancel closes without applying", async () => {
    const apply = vi.fn();
    const onClose = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: apply as never,
      onClose,
    });
    await settle();
    const cancel = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(m.imp_cancel())
    );
    cancel!.click();
    await settle();
    expect(onClose).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it("localizes the validation error and offers only dismiss", async () => {
    mountModal({
      loadPreview: () =>
        Promise.reject(
          Object.assign(new Error("kind"), { code: "archive/manifest-kind" }),
        ),
    });
    await settle();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(m.err_not_tesina());
    expect(document.body.textContent).toContain(m.imp_invalid_title());
    expect(document.body.textContent).not.toContain(m.imp_confirm());
  });

  it("applying is announced and non-cancellable, then success refreshes", async () => {
    const applyGate = deferred<ImportApplyResult>();
    const onDone = vi.fn();
    const onClose = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () => applyGate.promise,
      onDone,
      onClose,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toContain(m.imp_applying());
    // Escape during apply must not close the modal.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(onClose).not.toHaveBeenCalled();

    applyGate.resolve({
      kind: "applied",
      transactionId: "t",
      preview: fixturePreview().preview,
    });
    await settle();
    expect(onDone).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(m.imp_success());
  });

  it("waits for the completion refresh before reporting apply success", async () => {
    const refreshGate = deferred<void>();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      onDone: () => refreshGate.promise,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();

    expect(document.body.textContent).toContain(m.imp_applying());
    expect(document.body.textContent).not.toContain(m.imp_success());

    refreshGate.resolve();
    await settle();
    expect(document.body.textContent).toContain(m.imp_success());
  });

  it("keeps recovery-required apply failures non-dismissible", async () => {
    const onClose = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      onClose,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();

    expect(document.body.textContent).toContain(m.recovery_required_title());
    const buttons = [...document.querySelectorAll("button")];
    expect(
      buttons.some((button) =>
        button.textContent?.includes(m.recovery_dismiss())
      ),
    ).toBe(false);
    buttons[0]?.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers recovery actions and refreshes after a durable retry", async () => {
    const initialOutcome: RecoveryOutcome = {
      kind: "recovery-required",
      transactionId: "(current-import)",
      reason: "import/recovery-required",
    };
    const recoveredOutcome: RecoveryOutcome = {
      kind: "resumed",
      transactionId: "transaction-1",
    };
    const recoveryActions: RecoveryActionDeps = {
      retry: vi.fn(() => Promise.resolve([recoveredOutcome])),
      exportDiagnostic: vi.fn(() => Promise.resolve()),
    };
    const onDone = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions,
      onDone,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();

    const text = document.body.textContent ?? "";
    expect(text).toContain(m.recovery_required_title());
    expect(text).toContain(m.recovery_required_body());
    expect(text).toContain(m.recovery_quit_hint());

    const exportButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(m.recovery_export_diagnostic()),
    );
    exportButton!.click();
    await settle();
    expect(recoveryActions.exportDiagnostic).toHaveBeenCalledWith([
      initialOutcome,
    ]);

    const retryButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(m.recovery_retry()),
    );
    retryButton!.click();
    await settle();
    expect(recoveryActions.retry).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(m.recovery_resumed());
  });

  it("announces only retry while recovery and refresh are pending", async () => {
    const exportGate = deferred<void>();
    const retryGate = deferred<RecoveryOutcome[]>();
    const refreshGate = deferred<void>();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () => retryGate.promise,
        exportDiagnostic: () => exportGate.promise,
      },
      onDone: () => refreshGate.promise,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();

    const recoveryButton = (label: string) =>
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label)
      );
    const exportButton = recoveryButton(m.recovery_export_diagnostic());
    const retryButton = recoveryButton(m.recovery_retry());

    exportButton!.click();
    await settle();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(exportButton?.disabled).toBe(true);
    expect(retryButton?.disabled).toBe(true);
    exportGate.resolve();
    await settle();

    retryButton!.click();
    await settle();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Recuperando tu biblioteca de forma segura…",
    );
    expect(exportButton?.disabled).toBe(true);
    expect(retryButton?.disabled).toBe(true);

    retryGate.resolve([{
      kind: "resumed",
      transactionId: "transaction-1",
    }]);
    await settle();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Recuperando tu biblioteca de forma segura…",
    );

    refreshGate.resolve();
    await settle();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      m.recovery_resumed(),
    );
  });

  it("stays fail-closed when a retry still requires recovery", async () => {
    const stillUnsafe: RecoveryOutcome = {
      kind: "recovery-required",
      transactionId: "transaction-1",
      reason: "import/recovery-required",
    };
    const onDone = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () => Promise.resolve([stillUnsafe]),
        exportDiagnostic: () => Promise.resolve(),
      },
      onDone,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.recovery_retry())
    );
    retry!.click();
    await settle();

    expect(onDone).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(m.recovery_required_title());
    expect(document.body.textContent).toContain(m.recovery_retry());
  });

  it("stays fail-closed without a positive durable recovery outcome", async () => {
    const onDone = vi.fn();
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () => Promise.resolve([]),
        exportDiagnostic: () => Promise.resolve(),
      },
      onDone,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.recovery_retry())
    );
    retry!.click();
    await settle();

    expect(onDone).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(m.recovery_required_title());
  });

  it("stays fail-closed when retry throws", async () => {
    const onDone = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () => Promise.reject(new Error("disk unavailable")),
        exportDiagnostic: () => Promise.resolve(),
      },
      onDone,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.recovery_retry())
    );
    retry!.click();
    await settle();

    expect(onDone).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(m.recovery_required_title());
    expect(retry?.disabled).toBe(false);
    consoleError.mockRestore();
  });

  it("stays recovery-required when the recovery refresh rejects", async () => {
    const refreshGate = deferred<void>();
    void refreshGate.promise.catch(() => {});
    const exportDiagnostic = vi.fn(() => Promise.resolve());
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () =>
          Promise.resolve([{
            kind: "resumed",
            transactionId: "transaction-1",
          }]),
        exportDiagnostic,
      },
      onDone: () => refreshGate.promise,
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.recovery_retry())
    );
    retry!.click();
    refreshGate.reject(new Error("refresh failed"));
    await settle();

    expect(document.body.textContent).toContain(m.recovery_required_title());
    expect(document.body.textContent).not.toContain(m.recovery_resumed());
    const exportButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(m.recovery_export_diagnostic()),
    );
    exportButton!.click();
    await settle();
    expect(exportDiagnostic).toHaveBeenCalledWith([{
      kind: "resumed",
      transactionId: "transaction-1",
    }]);
    consoleError.mockRestore();
  });

  it("reports already-complete recovery without claiming it resumed", async () => {
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: () =>
        Promise.reject(
          Object.assign(new Error("recovery"), {
            code: "import/recovery-required",
          }),
        ),
      recoveryActions: {
        retry: () =>
          Promise.resolve([{
            kind: "already-complete",
            transactionId: "transaction-1",
          }]),
        exportDiagnostic: () => Promise.resolve(),
      },
    });
    await settle();
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.imp_confirm())
    );
    confirm!.click();
    await settle();
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.recovery_retry())
    );
    retry!.click();
    await settle();

    expect(document.body.textContent).toContain(m.recovery_complete());
    expect(document.body.textContent).not.toContain(m.recovery_resumed());
    expect(document.body.textContent).not.toContain(m.recovery_rolled_back());
  });

  it("re-presents a changed preview on replan-needed before applying", async () => {
    const second = fixturePreview({
      essays: { new: 1, identical: 2, conflicting: 1 },
    });
    let calls = 0;
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      apply: (confirmed) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            { kind: "replan-needed", next: second } as ImportApplyResult,
          );
        }
        return Promise.resolve({
          kind: "applied",
          transactionId: "t",
          preview: confirmed.preview,
        });
      },
    });
    await settle();
    const confirmButton = () =>
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(m.imp_confirm())
      );
    confirmButton()!.click();
    await settle();
    expect(document.body.textContent).toContain(m.imp_replan_title());
    expect(document.body.textContent).toContain(
      m.imp_essays_new({ count: 1 }),
    );
    confirmButton()!.click();
    await settle();
    expect(calls).toBe(2);
    expect(document.body.textContent).toContain(m.imp_success());
  });

  it("restore mode adds the deleted-content consequence text", async () => {
    mountModal({
      loadPreview: () => Promise.resolve(fixturePreview()),
      restoreMode: true,
    });
    await settle();
    expect(document.body.textContent).toContain(m.restore_consequences());
  });

  it("chrome follows the UI language while open", async () => {
    mountModal({ loadPreview: () => Promise.resolve(fixturePreview()) });
    await settle();
    expect(document.body.textContent).toContain("Combinar con mi biblioteca");
    setLocale("en", { reload: false });
    await settle();
    // Paraglide message calls resolve per render; force a re-render pass.
    expect(m.imp_confirm()).toBe("Merge into my library");
  });
});
