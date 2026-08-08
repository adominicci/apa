// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages";
import { uiLocale } from "$lib/state/uiLocale.svelte";
import BackupSetupWizard, {
  type BackupWizardIo,
} from "./BackupSetupWizard.svelte";

/**
 * Tasks 10.1/10.2/10.8: five explicit steps, cancellation everywhere,
 * affirmative consent before the real write, failure retry/change paths,
 * bilingual text, and no configuration before the validated test.
 */

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

const PENDING = {
  canonicalFolderPath: "/Users/ana/Backups",
  backupSubfolderPath: "/Users/ana/Backups/Tesina Backups",
};

function fakeIo(overrides: Partial<BackupWizardIo> = {}) {
  const io = {
    pickFolder: vi.fn<BackupWizardIo["pickFolder"]>(() =>
      Promise.resolve("/Users/ana/Backups")
    ),
    begin: vi.fn<BackupWizardIo["begin"]>(() => Promise.resolve(PENDING)),
    writeTest: vi.fn<BackupWizardIo["writeTest"]>(() =>
      Promise.resolve({ fileName: "Test.tesina", contentDigest: "cd-1" })
    ),
    activate: vi.fn<BackupWizardIo["activate"]>(() => Promise.resolve()),
    cancel: vi.fn<BackupWizardIo["cancel"]>(() => Promise.resolve()),
  };
  return Object.assign(io, overrides);
}

let component: Record<string, unknown> | null = null;

function mountWizard(props: {
  io: BackupWizardIo;
  onConfigured?: () => void;
  onClose?: () => void;
}): void {
  component = mount(BackupSetupWizard, {
    target: document.body,
    props: {
      io: props.io,
      onConfigured: props.onConfigured ?? (() => {}),
      onClose: props.onClose ?? (() => {}),
    },
  }) as Record<string, unknown>;
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  );
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = "";
  uiLocale.current = "es";
});

async function advanceToLocation(io: BackupWizardIo): Promise<void> {
  mountWizard({ io });
  await settle();
  buttonByText(m.bk_continue())!.click();
  await settle();
}

async function advanceToTest(io: BackupWizardIo): Promise<void> {
  await advanceToLocation(io);
  buttonByText(m.bk_choose_folder())!.click();
  await settle();
  buttonByText(m.bk_continue())!.click(); // location → privacy
  await settle();
  buttonByText(m.bk_continue())!.click(); // privacy → test
  await settle();
}

describe("BackupSetupWizard", () => {
  it("walks all five steps, requires consent, and configures last", async () => {
    const io = fakeIo();
    const onConfigured = vi.fn();
    mountWizard({ io, onConfigured });
    await settle();

    // Step 1 — Why: local-first + the four providers, no integration claim.
    expect(bodyText()).toContain(m.bk_why_title());
    for (
      const provider of ["Google Drive", "iCloud Drive", "OneDrive", "Dropbox"]
    ) {
      expect(bodyText()).toContain(provider);
    }
    expect(bodyText()).toContain(m.bk_why_provider_note());
    buttonByText(m.bk_continue())!.click();
    await settle();

    // Step 2 — Choose location.
    expect(bodyText()).toContain(m.bk_location_title());
    expect(buttonByText(m.bk_continue())!.disabled).toBe(true);
    buttonByText(m.bk_choose_folder())!.click();
    await settle();
    expect(io.begin).toHaveBeenCalledWith("/Users/ana/Backups");
    expect(bodyText()).toContain(
      m.bk_chosen_folder({ path: PENDING.canonicalFolderPath }),
    );
    buttonByText(m.bk_continue())!.click();
    await settle();

    // Step 3 — Review privacy (complete unencrypted copy).
    expect(bodyText()).toContain(m.bk_privacy_title());
    expect(bodyText()).toContain(m.bk_privacy_body());
    buttonByText(m.bk_continue())!.click();
    await settle();

    // Step 4 — Test backup: exact destination incl. subfolder + consent.
    expect(bodyText()).toContain(
      m.bk_test_destination({ path: PENDING.backupSubfolderPath }),
    );
    expect(bodyText()).toContain(m.bk_test_explain());
    const write = buttonByText(m.bk_test_write())!;
    expect(write.disabled).toBe(true); // affirmative consent required
    expect(io.writeTest).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await settle();
    expect(buttonByText(m.bk_test_write())!.disabled).toBe(false);
    buttonByText(m.bk_test_write())!.click();
    await settle();
    expect(io.writeTest).toHaveBeenCalledOnce();
    expect(io.activate).toHaveBeenCalledWith(
      expect.objectContaining({ contentDigest: "cd-1" }),
    );

    // Step 5 — Success: local-only verification + next expected backup.
    expect(bodyText()).toContain(m.bk_success_title());
    expect(bodyText()).toContain(m.bk_success_local_only());
    expect(bodyText()).toContain(m.bk_success_next());
    buttonByText(m.bk_done())!.click();
    expect(onConfigured).toHaveBeenCalledOnce();
  });

  it("does not activate before the test write resolves", async () => {
    const gate = deferred<{ fileName: string; contentDigest: string }>();
    const io = fakeIo({ writeTest: vi.fn(() => gate.promise) });
    await advanceToTest(io);
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await settle();
    buttonByText(m.bk_test_write())!.click();
    await settle();
    // A live announcement covers the long write; nothing is configured yet.
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      m.bk_test_running(),
    );
    expect(io.activate).not.toHaveBeenCalled();
    gate.resolve({ fileName: "T.tesina", contentDigest: "cd-2" });
    await settle();
    expect(io.activate).toHaveBeenCalledOnce();
  });

  it("cancel at every pre-success step cleans up and never configures", async () => {
    const steps = [0, 1, 2, 3];
    for (const advance of steps) {
      const io = fakeIo();
      const onClose = vi.fn();
      mountWizard({ io, onClose });
      await settle();
      for (let i = 0; i < advance; i += 1) {
        if (i === 1) {
          buttonByText(m.bk_choose_folder())!.click();
          await settle();
        }
        buttonByText(m.bk_continue())!.click();
        await settle();
      }
      buttonByText(m.bk_cancel())!.click();
      await settle();
      expect(io.cancel, `step ${advance}`).toHaveBeenCalledOnce();
      expect(io.activate, `step ${advance}`).not.toHaveBeenCalled();
      expect(onClose, `step ${advance}`).toHaveBeenCalledOnce();
      if (component) unmount(component);
      component = null;
      document.body.innerHTML = "";
    }
  });

  it("a cancelled folder picker stays on the location step", async () => {
    const io = fakeIo({ pickFolder: vi.fn(() => Promise.resolve(null)) });
    await advanceToLocation(io);
    buttonByText(m.bk_choose_folder())!.click();
    await settle();
    expect(io.begin).not.toHaveBeenCalled();
    expect(bodyText()).toContain(m.bk_location_title());
    expect(bodyText()).toContain(m.bk_no_folder_yet());
    expect(buttonByText(m.bk_continue())!.disabled).toBe(true);
  });

  it("shows a localized rejection when the folder is inside app data", async () => {
    const io = fakeIo({
      begin: vi.fn(() =>
        Promise.reject({ code: "inside_app_data", detail: "nope" })
      ),
    });
    await advanceToLocation(io);
    buttonByText(m.bk_choose_folder())!.click();
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      m.bk_err_inside_app_data(),
    );
    expect(buttonByText(m.bk_continue())!.disabled).toBe(true);
  });

  it("test failure offers Retry and Choose another folder", async () => {
    const io = fakeIo();
    io.writeTest
      .mockRejectedValueOnce({ code: "folder_unavailable", detail: "off" });
    await advanceToTest(io);
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await settle();
    buttonByText(m.bk_test_write())!.click();
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(m.bk_err_folder_unavailable());
    expect(io.activate).not.toHaveBeenCalled();

    // Retry runs a fresh test and then activates.
    buttonByText(m.bk_retry())!.click();
    await settle();
    expect(io.writeTest).toHaveBeenCalledTimes(2);
    expect(io.activate).toHaveBeenCalledOnce();
    expect(bodyText()).toContain(m.bk_success_title());
  });

  it("Choose another folder cleans up via cancel and restarts selection", async () => {
    const io = fakeIo({
      writeTest: vi.fn(() =>
        Promise.reject({ code: "io", detail: "disk full" })
      ),
    });
    await advanceToTest(io);
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await settle();
    buttonByText(m.bk_test_write())!.click();
    await settle();
    buttonByText(m.bk_choose_another())!.click();
    await settle();
    expect(io.cancel).toHaveBeenCalledOnce();
    expect(io.activate).not.toHaveBeenCalled();
    expect(bodyText()).toContain(m.bk_location_title());
    expect(bodyText()).toContain(m.bk_no_folder_yet());
  });

  it("renders Spanish and English wizard chrome from the UI locale", async () => {
    const io = fakeIo();
    mountWizard({ io });
    await settle();
    expect(bodyText()).toContain("¿Por qué respaldar?");
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = "";

    uiLocale.current = "en";
    mountWizard({ io: fakeIo() });
    await settle();
    expect(bodyText()).toContain("Why back up?");
  });
});
