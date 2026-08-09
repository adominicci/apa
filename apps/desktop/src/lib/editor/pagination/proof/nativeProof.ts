import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createEmptyEssay } from "../../../model/essay.ts";
import {
  renderEssayCss,
  renderEssayHtml,
} from "../../../preview/renderEssayHtml.ts";
import { createTesinaEditor } from "../../createEditor.ts";
import { insertCitation } from "../../citation.ts";
import {
  type ReferenceDecorationEnv,
  refreshReferenceDecoration,
  repaintReferenceDecoration,
} from "../../referenceDecoration.ts";
import {
  createPaginationMeasurer,
  type PaginationMeasurer,
  type PaginationMeasurerOptions,
} from "../measure.ts";
import { calculatePaperScale } from "../paperScale.ts";
import { composeDocumentPages } from "../pageComposition.ts";
import { PAGINATION_RESPONSIVENESS_BUDGET } from "../performanceBudget.ts";
import {
  createPaginationPlugin,
  invalidatePagination,
  paginationPluginKey,
} from "../extension.ts";
import type { PaginationStateReport } from "../types.ts";
import {
  createLongDocumentFixtures,
  createStablePaginationParityFixture,
} from "./longDocumentFixture.ts";
import {
  createDisposablePaginationProofPlugin,
  disposablePaginationProofKey,
  type DisposablePaginationProofPlan,
  setDisposablePaginationProofPlan,
} from "./disposablePaginationProof.ts";
import {
  createNativeProofBridge,
  type NativeProofBridgeScope,
} from "./nativeBridge.ts";
import { inlineFlowVisualHeight } from "./nativeProofGeometry.ts";
import { samePlannerFragmentInputs } from "./plannerInputEquality.ts";
import {
  countCausalStableReports,
  evaluateLivePagedGeometry,
  evaluateNativePaginationWorkload,
  latestSettledNativeReport,
  type NativePaginationOperationResult,
  type NativePaginationWorkloadPages,
  type NativePaginationWorkloadResult,
  percentile95,
  remainingNativeDeadlineMs,
  waitForNativeCondition,
} from "./nativePerformance.ts";
import {
  AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS,
  NATIVE_EXPANDED_PROOF_BUDGET_MS,
} from "./nativeProofDeadlines.ts";
import { startProofPageWatchdog } from "./proofPageWatchdog.ts";
import "./nativeProof.css";

interface ProofResult {
  passed: boolean;
  engine: string;
  checks: Record<string, boolean>;
  metrics: Record<string, number | string>;
  error?: string;
}

const nativeBridge = createNativeProofBridge(
  globalThis as unknown as NativeProofBridgeScope,
);

function diagnostic(stage: string, detail: Record<string, unknown> = {}): void {
  nativeBridge.postDiagnostic({
    stage,
    ...detail,
  });
}

diagnostic("module-start", { readyState: document.readyState });

let frameIndex = 0;
const frame = (action?: () => void) =>
  new Promise<void>((resolve) => {
    const index = ++frameIndex;
    diagnostic("frame-request", {
      index,
      visibilityState: document.visibilityState,
    });
    requestAnimationFrame(() => {
      action?.();
      diagnostic("frame-resolve", {
        index,
        visibilityState: document.visibilityState,
      });
      resolve();
    });
  });

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing proof element: ${selector}`);
  return element;
}

function positionOfParagraph(doc: PMNode, needle: string): number {
  const result = maybePositionOfParagraph(doc, needle);
  if (result === null) throw new Error(`Paragraph not found: ${needle}`);
  return result;
}

function maybePositionOfParagraph(doc: PMNode, needle: string): number | null {
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (node.type.name === "paragraph" && node.textContent.includes(needle)) {
      result = pos;
      return false;
    }
    return true;
  });
  return result;
}

function positionsOf(doc: PMNode, type: string): number[] {
  const result: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === type) result.push(pos);
    return true;
  });
  return result;
}

function textHasMarkBetween(
  doc: PMNode,
  from: number,
  to: number,
  markName: string,
): boolean {
  let sawText = false;
  let everyTextHasMark = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    sawText = true;
    if (!node.marks.some((mark) => mark.type.name === markName)) {
      everyTextHasMark = false;
    }
    return true;
  });
  return sawText && everyTextHasMark;
}

function deriveTrailingFigurePlan(
  doc: PMNode,
  epoch: number,
): DisposablePaginationProofPlan {
  const figures = positionsOf(doc, "figure");
  return {
    epoch,
    gaps: figures.length > 1
      ? [{ kind: "block", pos: figures[1]!, height: 180 }]
      : [],
  };
}

function closeEnough(left: DOMRect, right: DOMRect): boolean {
  return Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5;
}

interface LayoutSnapshot {
  body: DOMRect;
  gap: DOMRect;
  documentHeight: number;
  resizeRevision: number;
}

function captureLayout(
  body: HTMLElement,
  gap: HTMLElement,
  resizeRevision = 0,
): LayoutSnapshot {
  return {
    body: body.getBoundingClientRect(),
    gap: gap.getBoundingClientRect(),
    documentHeight: document.documentElement.scrollHeight,
    resizeRevision,
  };
}

function sameLayout(left: LayoutSnapshot, right: LayoutSnapshot): boolean {
  return closeEnough(left.body, right.body) &&
    closeEnough(left.gap, right.gap) &&
    left.documentHeight === right.documentHeight &&
    left.resizeRevision === right.resizeRevision;
}

async function waitForCondition(
  description: string,
  condition: () => boolean,
  maxFrames = 120,
): Promise<number> {
  for (let frames = 0; frames <= maxFrames; frames += 1) {
    if (condition()) return frames;
    await frame();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForStableLayout(
  body: HTMLElement,
  gap: HTMLElement,
  readResizeRevision: () => number = () => 0,
  consecutiveStableFrames = 3,
  maxFrames = 120,
): Promise<{ snapshot: LayoutSnapshot; frames: number }> {
  let previous = captureLayout(body, gap, readResizeRevision());
  let stableFrames = 0;
  for (let frames = 1; frames <= maxFrames; frames += 1) {
    await frame();
    const current = captureLayout(body, gap, readResizeRevision());
    stableFrames = sameLayout(previous, current) ? stableFrames + 1 : 0;
    if (stableFrames >= consecutiveStableFrames) {
      return { snapshot: current, frames };
    }
    previous = current;
  }
  throw new Error("Layout did not stabilize before the native proof deadline");
}

async function waitForStableMeasurement(
  description: string,
  measure: () => number,
  consecutiveStableFrames = 3,
  maxFrames = 120,
): Promise<{ value: number; frames: number }> {
  let previous = measure();
  let stableFrames = 0;
  for (let frames = 1; frames <= maxFrames; frames += 1) {
    await frame();
    const current = measure();
    stableFrames = Math.abs(previous - current) < 0.5 ? stableFrames + 1 : 0;
    if (stableFrames >= consecutiveStableFrames) {
      return { value: current, frames };
    }
    previous = current;
  }
  throw new Error(`${description} did not stabilize`);
}

class NativePaginationFrameLedger {
  readonly #nativeRequest = globalThis.requestAnimationFrame.bind(globalThis);
  readonly #nativeCancel = globalThis.cancelAnimationFrame.bind(globalThis);
  readonly #pending = new Set<number>();
  executed = 0;
  maxPending = 0;

  request = (callback: FrameRequestCallback): number => {
    let handle = 0;
    handle = this.#nativeRequest((timestamp) => {
      this.#pending.delete(handle);
      this.executed += 1;
      callback(timestamp);
    });
    this.#pending.add(handle);
    this.maxPending = Math.max(this.maxPending, this.#pending.size);
    return handle;
  };

  cancel = (handle: number): void => {
    this.#pending.delete(handle);
    this.#nativeCancel(handle);
  };
}

interface CapturedNativeOperation {
  result: NativePaginationOperationResult;
  reports: PaginationStateReport[];
  targetEpoch: number;
}

function latestStableReport(
  reports: readonly PaginationStateReport[],
): PaginationStateReport | undefined {
  return reports.findLast((report) => report.status === "stable");
}

async function captureNativePaginationOperation(
  editor: Editor,
  reports: PaginationStateReport[],
  frames: NativePaginationFrameLedger,
  description: string,
  timeoutMs: number,
  mutate: () => void,
  outcomeSatisfied: () => boolean = () => true,
  diagnosticState: () => Record<string, unknown> = () => ({}),
): Promise<CapturedNativeOperation> {
  const reportIndex = reports.length;
  const executedBefore = frames.executed;
  const startedAt = performance.now();
  mutate();
  const authoredDoc = editor.state.doc;
  const targetEpoch = paginationPluginKey.getState(editor.state)?.epoch;
  if (targetEpoch === undefined) {
    throw new Error(`Pagination state disappeared during ${description}`);
  }
  try {
    await waitForNativeCondition(
      `${description} to settle at or after epoch ${targetEpoch}`,
      () => {
        const current = paginationPluginKey.getState(editor.state);
        return latestSettledNativeReport(
          reports.slice(reportIndex),
          current,
          targetEpoch,
          editor.state.doc.eq(authoredDoc) && outcomeSatisfied(),
        ) !== undefined;
      },
      {
        timeoutMs,
        yieldControl: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await frame();
        },
      },
    );
  } catch (error) {
    const current = paginationPluginKey.getState(editor.state);
    diagnostic("native-performance-operation-timeout", {
      description,
      timeoutMs,
      elapsedMs: performance.now() - startedAt,
      targetEpoch,
      currentState: current
        ? {
          status: current.status,
          epoch: current.epoch,
          pass: current.pass,
          reason: current.reason,
          hasCandidate: current.candidateSignature !== null,
          hasStablePlan: current.lastStablePlan !== null,
        }
        : null,
      authoredDocMatches: editor.state.doc.eq(authoredDoc),
      outcomeSatisfied: outcomeSatisfied(),
      framesExecuted: frames.executed - executedBefore,
      reportTrail: reports.slice(reportIndex).map((report) => ({
        status: report.status,
        epoch: report.epoch,
        reason: report.reason,
        pageCount: report.pageCount,
      })),
      ...diagnosticState(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const operationReports = reports.slice(reportIndex);
  const stable = latestSettledNativeReport(
    operationReports,
    paginationPluginKey.getState(editor.state),
    targetEpoch,
    editor.state.doc.eq(authoredDoc) && outcomeSatisfied(),
  );
  if (!stable) throw new Error(`${description} did not produce a stable plan`);
  return {
    result: {
      settlementMs: performance.now() - startedAt,
      paginationFrames: frames.executed - executedBefore,
      stableCommits: countCausalStableReports(operationReports, targetEpoch),
      fallbackCommits:
        operationReports.filter((report) => report.status === "fallback")
          .length,
      startEpoch: targetEpoch,
      endEpoch: stable.epoch,
    },
    reports: operationReports,
    targetEpoch,
  };
}

function workloadParagraphText(index: number): string {
  const sentence =
    `Rendered workload paragraph ${index} records an invented sequence of ` +
    "archive cards, envelope labels, rainfall tallies, volunteer checks, " +
    "and review notes so native pagination has realistic prose to wrap.";
  return `${sentence} ${sentence}`;
}

function renderedWorkloadContent(targetPages: NativePaginationWorkloadPages) {
  return {
    type: "doc",
    content: [{
      type: "sectionBody",
      content: Array.from({ length: targetPages * 9 }, (_, index) => ({
        type: "paragraph",
        content: [{ type: "text", text: workloadParagraphText(index + 1) }],
      })),
    }],
  };
}

async function waitForLatestStableReport(
  editor: Editor,
  reports: PaginationStateReport[],
  description: string,
  timeoutMs: number,
): Promise<PaginationStateReport> {
  let stable: PaginationStateReport | undefined;
  await waitForNativeCondition(
    description,
    () => {
      stable = latestSettledNativeReport(
        reports,
        paginationPluginKey.getState(editor.state),
      );
      return stable !== undefined;
    },
    {
      timeoutMs,
      yieldControl: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await frame();
      },
    },
  );
  if (!stable) throw new Error(`${description} did not produce a stable plan`);
  return stable;
}

async function runNativePerformanceWorkload(
  targetPages: NativePaginationWorkloadPages,
  mount: HTMLElement,
  shell: HTMLElement,
  proofEditor: HTMLElement,
  fixture: ReturnType<typeof createLongDocumentFixtures>["en"],
): Promise<NativePaginationWorkloadResult> {
  mount.replaceChildren();
  shell.style.setProperty(
    "--doc-font",
    'Georgia, "Times New Roman", serif',
  );
  shell.style.setProperty("--doc-font-size", "11pt");
  proofEditor.style.transform = "";

  const reports: PaginationStateReport[] = [];
  const frames = new NativePaginationFrameLedger();
  const budget = PAGINATION_RESPONSIVENESS_BUDGET.workloads[targetPages];
  const setupDeadline = performance.now() +
    NATIVE_EXPANDED_PROOF_BUDGET_MS.workloadSetupPerFixture;
  let layoutReads = 0;
  let layoutReadsCompleted = 0;
  let layoutReadsInFlight = 0;
  const layoutReadHistory: Array<Record<string, unknown>> = [];
  let referencePageCount = 1;
  const referenceEnv: ReferenceDecorationEnv = {
    references: fixture.references.slice(0, 1),
    locale: "en",
    emptyLabel: "unused",
    onPageCountChange: (count: number) => referencePageCount = count,
  };
  const editor = createTesinaEditor({
    element: mount,
    content: renderedWorkloadContent(targetPages),
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(
        fixture.references.map((reference) => [reference.id, reference]),
      ),
      locale: "en",
    },
    referenceEnv,
    paginationEnv: null,
  });
  const createMeasuredLayout = (
    options: PaginationMeasurerOptions,
  ): PaginationMeasurer => {
    const productionMeasurer = createPaginationMeasurer(options);
    return {
      read: async (request) => {
        layoutReads += 1;
        layoutReadsInFlight += 1;
        const startedAt = performance.now();
        try {
          const result = await productionMeasurer.read(request);
          layoutReadsCompleted += 1;
          layoutReadHistory.push({
            epoch: request.epoch,
            durationMs: performance.now() - startedAt,
            status: result.status,
            fragments: result.status === "measured"
              ? result.fragments.length
              : undefined,
          });
          return result;
        } catch (error) {
          layoutReadHistory.push({
            epoch: request.epoch,
            durationMs: performance.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          layoutReadsInFlight -= 1;
        }
      },
      destroy: () => productionMeasurer.destroy(),
    };
  };

  try {
    editor.registerPlugin(createPaginationPlugin({
      reason: "canonical-layout",
      getReferencePageCount: () => referencePageCount,
      onPageCount: (report) => reports.push(report),
    }, {
      createMeasurer: createMeasuredLayout,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    }));

    const waitForWorkloadSetup = async (description: string) => {
      const expectedEpoch = paginationPluginKey.getState(editor.state)?.epoch;
      try {
        return await waitForLatestStableReport(
          editor,
          reports,
          description,
          remainingNativeDeadlineMs(setupDeadline),
        );
      } catch (error) {
        const current = paginationPluginKey.getState(editor.state);
        const images = [...mount.querySelectorAll<HTMLImageElement>("img")];
        diagnostic("native-performance-setup-timeout", {
          targetPages,
          description,
          expectedEpoch,
          currentEpoch: current?.epoch,
          superseded: current?.epoch !== expectedEpoch,
          pluginState: current
            ? {
              status: current.status,
              epoch: current.epoch,
              pass: current.pass,
              reason: current.reason,
              hasCandidate: current.candidateSignature !== null,
              hasStablePlan: current.lastStablePlan !== null,
            }
            : null,
          reportTrail: reports.slice(-12).map((report) => ({
            status: report.status,
            epoch: report.epoch,
            reason: report.reason,
            pageCount: report.pageCount,
          })),
          layoutReads,
          layoutReadsCompleted,
          layoutReadsInFlight,
          layoutReadHistory: layoutReadHistory.slice(-8),
          fontStatus: document.fonts?.status ?? "unavailable",
          imageCount: images.length,
          pendingImageCount: images.filter((image) => !image.complete).length,
          referencePageCount,
          referenceEntries: mount.querySelectorAll(".ref-entry").length,
          paragraphCount: positionsOf(editor.state.doc, "paragraph").length,
          docContentSize: editor.state.doc.content.size,
          stablePageStarts: current?.lastStablePlan?.pageStarts.length ?? 0,
          stablePageGaps: current?.lastStablePlan?.pageGaps.length ?? 0,
          paintedPageGaps: mount.querySelectorAll("[data-pagination-gap]")
            .length,
          paintedPageNumbers: mount.querySelectorAll(
            "[data-pagination-page-number]",
          ).length,
          referenceDecorationActive: mount.querySelector(
            "[data-reference-pages]",
          ) !== null,
          remainingSetupMs: remainingNativeDeadlineMs(setupDeadline),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    let baseline = await waitForWorkloadSetup(
      `${targetPages}-page native workload initial settlement`,
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const authored = baseline.pageCount?.authored ?? 0;
      if (authored === targetPages) break;
      const plan = baseline.visiblePlan ?? baseline.lastStablePlan;
      if (!plan) throw new Error("Native workload has no stable plan");
      if (authored > targetPages) {
        const cutoff = plan.pageStarts[targetPages]?.pos;
        const documentEnd = editor.state.doc.content.size - 1;
        if (cutoff === undefined || cutoff >= documentEnd) {
          throw new Error(
            `Cannot trim ${authored} authored pages to ${targetPages}`,
          );
        }
        editor.view.dispatch(editor.state.tr.delete(cutoff, documentEnd));
      } else {
        const paragraphType = editor.schema.nodes["paragraph"];
        if (!paragraphType) throw new Error("Paragraph schema is unavailable");
        const additional = Array.from(
          { length: (targetPages - authored) * 9 },
          (_, index) =>
            paragraphType.create(
              null,
              editor.schema.text(
                workloadParagraphText(editor.state.doc.childCount + index),
              ),
            ),
        );
        editor.view.dispatch(
          editor.state.tr.insert(
            editor.state.doc.content.size - 1,
            additional,
          ),
        );
      }
      baseline = await waitForWorkloadSetup(
        `${targetPages}-page native workload calibration`,
      );
    }
    const authoredPages = baseline.pageCount?.authored ?? 0;
    if (authoredPages !== targetPages) {
      throw new Error(
        `Native workload calibrated to ${authoredPages}, expected ${targetPages}`,
      );
    }

    const firstParagraph = positionsOf(editor.state.doc, "paragraph")[0]! + 1;
    const operationDiagnosticState = () => ({
      targetPages,
      layoutReads,
      layoutReadsCompleted,
      layoutReadsInFlight,
      layoutReadHistory: layoutReadHistory.slice(-8),
      fontStatus: document.fonts?.status ?? "unavailable",
      referencePageCount,
      referenceEntries: mount.querySelectorAll(".ref-entry").length,
    });
    const inputDurationsMs: number[] = [];
    const readsBeforeInput = layoutReads;
    const rapidTyping = await captureNativePaginationOperation(
      editor,
      reports,
      frames,
      `${targetPages}-page rapid typing`,
      budget.typingDeletionMs,
      () => {
        for (let index = 0; index < 20; index += 1) {
          const startedAt = performance.now();
          editor.view.dispatch(
            editor.state.tr.insertText("x", firstParagraph),
          );
          inputDurationsMs.push(performance.now() - startedAt);
        }
      },
      undefined,
      operationDiagnosticState,
    );
    const readsDuringInput = layoutReads - readsBeforeInput;

    let deletionInputMs = 0;
    let deletionReadsDuringInput = 0;
    const deletion = await captureNativePaginationOperation(
      editor,
      reports,
      frames,
      `${targetPages}-page deletion`,
      budget.typingDeletionMs,
      () => {
        const readsBeforeDeletion = layoutReads;
        const startedAt = performance.now();
        editor.view.dispatch(
          editor.state.tr.delete(firstParagraph, firstParagraph + 20),
        );
        deletionInputMs = performance.now() - startedAt;
        deletionReadsDuringInput = layoutReads - readsBeforeDeletion;
      },
      undefined,
      operationDiagnosticState,
    );
    inputDurationsMs.push(deletionInputMs);

    const referenceEntriesBefore = mount.querySelectorAll(".ref-entry").length;
    const referenceRefresh = await captureNativePaginationOperation(
      editor,
      reports,
      frames,
      `${targetPages}-page reference refresh`,
      budget.referenceFontMs,
      () => {
        referenceEnv.references = fixture.references;
        refreshReferenceDecoration(editor);
      },
      () =>
        mount.querySelectorAll(".ref-entry").length > referenceEntriesBefore,
      operationDiagnosticState,
    );
    const referenceEntriesAfter = mount.querySelectorAll(".ref-entry").length;

    const fontFamilyBefore = getComputedStyle(editor.view.dom).fontFamily;
    const fontChange = await captureNativePaginationOperation(
      editor,
      reports,
      frames,
      `${targetPages}-page selected-font change`,
      budget.referenceFontMs,
      () => {
        shell.style.setProperty(
          "--doc-font",
          '"Times New Roman", Times, Georgia, serif',
        );
        shell.style.setProperty("--doc-font-size", "12pt");
        invalidatePagination(editor, "font");
      },
      () =>
        getComputedStyle(editor.view.dom).fontFamily !== fontFamilyBefore &&
        getComputedStyle(editor.view.dom).fontSize === "16px",
      operationDiagnosticState,
    );
    const fontFamilyAfter = getComputedStyle(editor.view.dom).fontFamily;

    const resizeReportIndex = reports.length;
    const resizeFramesBefore = frames.executed;
    const resizeEpoch = paginationPluginKey.getState(editor.state)?.epoch ?? -1;
    const scaleBefore = editor.view.dom.getBoundingClientRect().width /
      editor.view.dom.offsetWidth;
    const resizeStartedAt = performance.now();
    const scaledLayout = calculatePaperScale(612, proofEditor.scrollHeight);
    proofEditor.style.transformOrigin = "top left";
    proofEditor.style.transform = `scale(${scaledLayout.scale})`;
    await frame();
    await frame();
    await frame();
    const scaleAfter = editor.view.dom.getBoundingClientRect().width /
      editor.view.dom.offsetWidth;
    const resizeEndEpoch = paginationPluginKey.getState(editor.state)?.epoch ??
      -1;
    const resizeReports = reports.slice(resizeReportIndex);
    const scaleResize: NativePaginationOperationResult = {
      settlementMs: performance.now() - resizeStartedAt,
      paginationFrames: frames.executed - resizeFramesBefore,
      stableCommits: resizeReports.filter((report) =>
        report.status === "stable"
      ).length,
      fallbackCommits: resizeReports.filter((report) =>
        report.status === "fallback"
      ).length,
      startEpoch: resizeEpoch,
      endEpoch: resizeEndEpoch,
    };

    const capturedOperations = [
      rapidTyping,
      deletion,
      referenceRefresh,
      fontChange,
    ];
    const stableEpochCounts = new Map<number, number>();
    for (const report of reports) {
      if (report.status !== "stable") continue;
      stableEpochCounts.set(
        report.epoch,
        (stableEpochCounts.get(report.epoch) ?? 0) + 1,
      );
    }
    const finalStable = latestStableReport(reports)?.lastStablePlan;
    diagnostic("native-performance-fixture-identity", {
      targetPages,
      paragraphCount: positionsOf(editor.state.doc, "paragraph").length,
      docContentSize: editor.state.doc.content.size,
      stablePageStarts: finalStable?.pageStarts.length ?? 0,
      stablePageGaps: finalStable?.pageGaps.length ?? 0,
      paintedPageGaps: mount.querySelectorAll("[data-pagination-gap]").length,
      paintedPageNumbers: mount.querySelectorAll(
        "[data-pagination-page-number]",
      ).length,
      referenceDecorationActive: mount.querySelector(
        "[data-reference-pages]",
      ) !== null,
      referenceEntries: mount.querySelectorAll(".ref-entry").length,
    });
    return {
      targetPages,
      authoredPages,
      inputDurationsMs,
      maxPendingFrames: frames.maxPending,
      readsDuringInput: readsDuringInput + deletionReadsDuringInput,
      staleStableCommits: capturedOperations.reduce(
        (count, operation) =>
          count + operation.reports.filter((report) =>
            report.status === "stable" &&
            report.epoch < operation.targetEpoch
          ).length,
        0,
      ),
      duplicateStableEpochs: [...stableEpochCounts.values()].reduce(
        (count, occurrences) => count + Math.max(0, occurrences - 1),
        0,
      ),
      referenceEntriesBefore,
      referenceEntriesAfter,
      fontFamilyBefore,
      fontFamilyAfter,
      scaleBefore,
      scaleAfter,
      operations: {
        rapidTyping: rapidTyping.result,
        deletion: deletion.result,
        referenceRefresh: referenceRefresh.result,
        fontChange: fontChange.result,
        scaleResize,
      },
    };
  } finally {
    proofEditor.style.transform = "";
    editor.destroy();
    mount.replaceChildren();
  }
}

function domSelectionPosition(editor: Editor): number | null {
  const selection = document.getSelection();
  if (!selection?.focusNode) return null;
  try {
    return editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
  } catch {
    return null;
  }
}

async function runProof(): Promise<ProofResult> {
  diagnostic("proof-start");
  const fixture = createLongDocumentFixtures().en;
  diagnostic("fixture-created");
  const mount = requireElement<HTMLElement>("#proof-mount");
  const shell = requireElement<HTMLElement>("#proof-shell");
  shell.style.setProperty(
    "--body-title",
    JSON.stringify(
      "A Synthetic Archive Study of Community Seed Records, Seasonal Rainfall, Volunteer Checks, Envelope Labels, and Long-Term Planning Across Several Invented Coastal Districts",
    ),
  );
  const editor = createTesinaEditor({
    element: mount,
    content: fixture.content,
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(
        fixture.references.map((reference) => [reference.id, reference]),
      ),
      locale: "en",
    },
    referenceEnv: {
      references: fixture.references,
      locale: "en",
      emptyLabel: "unused",
    },
    paginationEnv: null,
  });
  let productionEditor: Editor | undefined;
  let parityEditor: Editor | undefined;
  diagnostic("editor-created");
  editor.registerPlugin(createDisposablePaginationProofPlugin());
  diagnostic("proof-plugin-registered");
  let paginationMeasurer: PaginationMeasurer | undefined;

  try {
    diagnostic("fonts-wait", { status: document.fonts.status });
    await document.fonts.ready;
    diagnostic("fonts-ready", { status: document.fonts.status });
    const resourceWaitFrames = await waitForCondition(
      "the document and fonts to finish loading",
      () =>
        document.readyState === "complete" &&
        document.fonts.status === "loaded" &&
        [...document.images].every((image) => image.complete),
    );
    diagnostic("initial-layout-inputs-ready", { resourceWaitFrames });
    const initialJson = JSON.stringify(editor.getJSON());
    const paragraphPos = positionOfParagraph(
      editor.state.doc,
      "Invented paragraph 1",
    );
    paginationMeasurer = createPaginationMeasurer({
      view: editor.view,
      onInvalidate: (reason) =>
        diagnostic("measurement-invalidated", { reason }),
    });
    const initialMeasurement = await paginationMeasurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => 1,
    });
    if (initialMeasurement.status !== "measured") {
      throw new Error("Initial production measurement was stale");
    }
    const paragraphLines = initialMeasurement.fragments.filter((fragment) =>
      fragment.lineGroup?.id === `text:${paragraphPos}`
    );
    const tableFragments = initialMeasurement.fragments.filter((fragment) =>
      fragment.kind === "tableRow"
    );
    const repeatedTableHeader = tableFragments[1]?.table?.repeatedHeader;
    const bodySectionPos = positionsOf(editor.state.doc, "sectionBody")[0]!;
    const bodySection = editor.view.nodeDOM(bodySectionPos) as HTMLElement;
    const firstBodyBlock = [...bodySection.children].find((child) =>
      !child.matches("[data-pagination-gap], [data-pagination-proof-gap]")
    ) as HTMLElement | undefined;
    if (!firstBodyBlock) throw new Error("Body section has no authored block");
    const bodySectionStyle = getComputedStyle(bodySection);
    const firstBodyBlockStyle = getComputedStyle(firstBodyBlock);
    const bodyContentTop = bodySection.getBoundingClientRect().top +
      Number.parseFloat(bodySectionStyle.borderTopWidth) +
      Number.parseFloat(bodySectionStyle.paddingTop);
    const generatedHeadingVisualHeight =
      firstBodyBlock.getBoundingClientRect().top - bodyContentTop -
      Number.parseFloat(firstBodyBlockStyle.marginTop);
    const generatedHeadingMeasuredHeight = initialMeasurement.fragments.find(
      (fragment) =>
        fragment.id === `section:${bodySectionPos}:generated-heading`,
    )?.height ?? 0;
    const generatedHeadingMeasurementMatchesVisualSpan = Math.abs(
      generatedHeadingMeasuredHeight - generatedHeadingVisualHeight,
    ) < 0.5;
    const firstTablePos = positionsOf(editor.state.doc, "apaTable")[0]!;
    const firstTableNode = editor.state.doc.nodeAt(firstTablePos)!;
    const firstTable = editor.view.nodeDOM(firstTablePos) as HTMLElement;
    const firstTableStyle = getComputedStyle(firstTable);
    const firstTableVisualHeight = firstTable.getBoundingClientRect().height +
      Number.parseFloat(firstTableStyle.marginTop) +
      Number.parseFloat(firstTableStyle.marginBottom);
    const firstTableFragments = initialMeasurement.fragments.filter(
      (fragment) =>
        fragment.from >= firstTablePos &&
        fragment.to <= firstTablePos + firstTableNode.nodeSize,
    );
    const firstTableMeasuredHeight = firstTableFragments.reduce(
      (total, fragment) => total + fragment.height,
      0,
    );
    const tableWrapperMarginsMeasured = Math.abs(
      firstTableMeasuredHeight - firstTableVisualHeight,
    ) < 0.5;
    const runInHeadingPos = positionsOf(editor.state.doc, "heading")[0]!;
    const runInBodyPos = positionOfParagraph(
      editor.state.doc,
      "Each volunteer checked the oldest packet first",
    );
    const runInHeading = editor.view.nodeDOM(runInHeadingPos) as HTMLElement;
    const runInBody = editor.view.nodeDOM(runInBodyPos) as HTMLElement;
    const runInRects = [
      ...Array.from(runInHeading.getClientRects()),
      ...Array.from(runInBody.getClientRects()),
    ];
    const runInLineHeight = Number.parseFloat(
      getComputedStyle(runInBody).lineHeight,
    );
    // Blink exposes the empty block terminator from p::after as a zero-height
    // client rect. It ends the inline flow but is not another visual line.
    const runInVisualHeight = inlineFlowVisualHeight(
      runInRects,
      runInLineHeight,
    );
    const runInPositiveAreaRectCount = runInRects.filter((rect) =>
      rect.width > 0 && rect.height > 0
    ).length;
    const measuredRunInHeight = initialMeasurement.fragments.filter(
      (fragment) =>
        fragment.id === `heading:${runInHeadingPos}` ||
        fragment.lineGroup?.id === `text:${runInBodyPos}`,
    ).reduce((total, fragment) => total + fragment.height, 0);
    const runInMeasurementMatchesVisualSpan = Math.abs(
      measuredRunInHeight - runInVisualHeight,
    ) < 0.5;
    const equationPos = positionsOf(editor.state.doc, "apaEquation")[0]!;
    const adjacentFigurePos = positionsOf(editor.state.doc, "figure")[1]!;
    const equationNode = editor.state.doc.nodeAt(equationPos)!;
    const adjacentFigureNode = editor.state.doc.nodeAt(adjacentFigurePos)!;
    const equationElement = editor.view.nodeDOM(equationPos) as HTMLElement;
    const adjacentFigureElement = editor.view.nodeDOM(
      adjacentFigurePos,
    ) as HTMLElement;
    const equationRect = equationElement.getBoundingClientRect();
    const adjacentFigureRect = adjacentFigureElement.getBoundingClientRect();
    const equationStyle = getComputedStyle(equationElement);
    const adjacentFigureStyle = getComputedStyle(adjacentFigureElement);
    const adjacentAtomicVisualAdvance = adjacentFigureRect.bottom +
      Number.parseFloat(adjacentFigureStyle.marginBottom) -
      (equationRect.top - Number.parseFloat(equationStyle.marginTop));
    const equationFragment = initialMeasurement.fragments.find((fragment) =>
      fragment.id === `apaEquation:${equationPos}` &&
      fragment.from === equationPos &&
      fragment.to === equationPos + equationNode.nodeSize &&
      fragment.kind === "atomic"
    );
    const adjacentFigureFragment = initialMeasurement.fragments.find(
      (fragment) =>
        fragment.id === `figure:${adjacentFigurePos}` &&
        fragment.from === adjacentFigurePos &&
        fragment.to === adjacentFigurePos + adjacentFigureNode.nodeSize &&
        fragment.kind === "atomic",
    );
    const adjacentAtomicMeasuredAdvance = (equationFragment?.height ?? 0) +
      (adjacentFigureFragment?.height ?? 0);
    const adjacentAtomicMarginsMeasuredOnce = equationFragment !== undefined &&
      adjacentFigureFragment !== undefined &&
      equationPos + equationNode.nodeSize === adjacentFigurePos &&
      equationElement.nextElementSibling === adjacentFigureElement &&
      Math.abs(
          adjacentAtomicMeasuredAdvance - adjacentAtomicVisualAdvance,
        ) < 0.5;
    const starts = paragraphLines.map((fragment) => fragment.breakBefore.pos);
    if (starts.length < 4) {
      throw new Error(
        `Expected at least four measured paragraph lines, got ${starts.length}`,
      );
    }
    const lineGapPos = starts[3]!;
    setDisposablePaginationProofPlan(editor, {
      epoch: 1,
      gaps: [{ kind: "line", pos: lineGapPos, height: 180 }],
    });
    const gapWaitFrames = await waitForCondition(
      "the first derived line-gap plan",
      () => !!document.querySelector("[data-pagination-proof-gap='line']"),
    );
    const lineGap = requireElement<HTMLElement>(
      "[data-pagination-proof-gap='line']",
    );
    const body = requireElement<HTMLElement>("[data-sec='body']");
    let resizeRevision = 0;
    const resizeObserver = new ResizeObserver(() => resizeRevision += 1);
    resizeObserver.observe(shell);
    resizeObserver.observe(body);
    resizeObserver.observe(lineGap);
    const hiddenStableLayout = await waitForStableLayout(
      body,
      lineGap,
      () => resizeRevision,
    );
    const normalizedMeasurement = await paginationMeasurer.read({
      epoch: 2,
      signal: new AbortController().signal,
      latestEpoch: () => 2,
    });
    if (normalizedMeasurement.status !== "measured") {
      throw new Error("Normalized production measurement was stale");
    }
    const normalizedParagraphLines = normalizedMeasurement.fragments.filter(
      (fragment) => fragment.lineGroup?.id === `text:${paragraphPos}`,
    );
    const existingDecorationsNormalized =
      normalizedParagraphLines.length === paragraphLines.length &&
      normalizedParagraphLines.every((fragment, index) => {
        const before = paragraphLines[index];
        return before?.from === fragment.from && before.to === fragment.to &&
          Math.abs(before.height - fragment.height) < 0.5;
      });
    const firstPlannedGap = hiddenStableLayout.snapshot.gap;
    const lineGapParentTag = lineGap.parentElement?.tagName ?? "none";
    const lineGapInsideParagraph = lineGapParentTag === "P";
    const resizeRevisionAtReveal = resizeRevision;
    await frame(() => shell.dataset["firstPlan"] = "stable");

    // Sampling in the frame after reveal observes the geometry used by the
    // first visible paint. Readiness itself is condition-based above/below.
    await frame();
    const firstVisibleLayout = captureLayout(body, lineGap, resizeRevision);
    const visibleStableLayout = await waitForStableLayout(
      body,
      lineGap,
      () => resizeRevision,
    );
    const conditionalFirstPaint = document.visibilityState === "visible" &&
      getComputedStyle(shell).visibility === "visible" &&
      firstVisibleLayout.resizeRevision === resizeRevisionAtReveal &&
      visibleStableLayout.snapshot.resizeRevision === resizeRevisionAtReveal &&
      sameLayout(hiddenStableLayout.snapshot, firstVisibleLayout) &&
      sameLayout(firstVisibleLayout, visibleStableLayout.snapshot);
    resizeObserver.disconnect();

    const beforeCaret = editor.view.coordsAtPos(lineGapPos - 1);
    const afterCaret = editor.view.coordsAtPos(lineGapPos + 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos - 2),
      ),
    );
    editor.view.focus();
    await waitForCondition(
      "a collapsed DOM caret immediately before the line gap",
      () => {
        const domSelection = document.getSelection();
        const pos = domSelectionPosition(editor);
        return domSelection?.isCollapsed === true && pos !== null &&
          pos < lineGapPos;
      },
    );
    const selectionToMove = document.getSelection();
    if (!selectionToMove || typeof selectionToMove.modify !== "function") {
      throw new Error("WKWebView Selection.modify is unavailable");
    }
    const caretStartPos = domSelectionPosition(editor);
    let caretMoveCount = 0;
    let caretAfterTraversal = caretStartPos;
    while (
      caretAfterTraversal !== null && caretAfterTraversal <= lineGapPos &&
      caretMoveCount < 12
    ) {
      selectionToMove.modify("move", "forward", "character");
      caretMoveCount += 1;
      await frame();
      caretAfterTraversal = domSelectionPosition(editor);
    }
    await waitForCondition(
      "ProseMirror to observe the DOM caret beyond the line gap",
      () =>
        editor.state.selection.empty &&
        editor.state.selection.head > lineGapPos,
      30,
    );
    const caretAfterTraversalCoords = editor.view.coordsAtPos(
      editor.state.selection.head,
    );
    const nativeInputPosition = editor.state.selection.head;
    const caretStayedFocused = editor.view.hasFocus();
    const caretEndpointInAuthoredText = editor.state.doc.resolve(
      nativeInputPosition,
    ).parent.inlineContent;
    const beforeNativeInputJson = JSON.stringify(editor.getJSON());
    let nativeInputEventCount = 0;
    const recordNativeInput = (event: Event) => {
      if (
        event instanceof InputEvent && event.inputType === "insertText" &&
        event.data === "Q"
      ) {
        nativeInputEventCount += 1;
      }
    };
    editor.view.dom.addEventListener("input", recordNativeInput);
    const nativeInputAccepted = document.execCommand(
      "insertText",
      false,
      "Q",
    );
    await waitForCondition(
      "native contenteditable input to update the ProseMirror document",
      () => JSON.stringify(editor.getJSON()) !== beforeNativeInputJson,
      30,
    );
    editor.view.dom.removeEventListener("input", recordNativeInput);
    const nativeInputChangedJson = JSON.stringify(editor.getJSON()) !==
      beforeNativeInputJson;
    const nativeInputInsertedAtTraversal = editor.state.doc.textBetween(
      nativeInputPosition,
      nativeInputPosition + 1,
      "",
      "",
    ) === "Q";
    const nativeCaretAfterInputPosition = editor.state.selection.head;
    const nativeInputUndoAccepted = editor.commands.undo();
    await waitForCondition(
      "one undo to restore the native input",
      () => JSON.stringify(editor.getJSON()) === beforeNativeInputJson,
      30,
    );
    const nativeInputUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeNativeInputJson;

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos - 6, lineGapPos + 6),
      ),
    );
    editor.view.focus();
    await waitForCondition(
      "the DOM selection spanning the line gap",
      () => document.getSelection()?.isCollapsed === false,
      30,
    );
    const domSelection = document.getSelection();
    const expectedSelection = editor.state.doc.textBetween(
      lineGapPos - 6,
      lineGapPos + 6,
      "",
      "",
    );
    const selectionAcrossGapProven =
      editor.state.selection.from === lineGapPos - 6 &&
      editor.state.selection.to === lineGapPos + 6 &&
      domSelection?.isCollapsed === false &&
      domSelection.toString() === expectedSelection;
    diagnostic("selection-snapshot", {
      stateFrom: editor.state.selection.from,
      stateTo: editor.state.selection.to,
      expectedSelection,
      domCollapsed: domSelection?.isCollapsed ?? null,
      domText: domSelection?.toString() ?? null,
      selectionAcrossGapProven,
    });

    const beforeFormattingJson = JSON.stringify(editor.getJSON());
    const formattingAccepted = editor.chain().focus().toggleBold().run();
    const formattingAppliedAcrossGap = textHasMarkBetween(
      editor.state.doc,
      lineGapPos - 6,
      lineGapPos + 6,
      "bold",
    );
    const formattingUndoAccepted = editor.commands.undo();
    const formattingUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeFormattingJson;
    const formattingRedoAccepted = editor.commands.redo();
    const formattingRedoRestored = textHasMarkBetween(
      editor.state.doc,
      lineGapPos - 6,
      lineGapPos + 6,
      "bold",
    );
    const formattingFinalUndoAccepted = editor.commands.undo();
    const formattingFinalUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeFormattingJson;

    const beforeCitationJson = JSON.stringify(editor.getJSON());
    const citationsBeforeInsert = positionsOf(editor.state.doc, "citation")
      .length;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos + 3),
      ),
    );
    insertCitation(editor, {
      items: [{ refId: "proof-ref-1" }],
      mode: "parenthetical",
    });
    const citationPositionsAfterInsert = positionsOf(
      editor.state.doc,
      "citation",
    );
    const citationInsertedBeyondGap =
      citationPositionsAfterInsert.length === citationsBeforeInsert + 1 &&
      citationPositionsAfterInsert.some((pos) => pos > lineGapPos);
    const citationUndoAccepted = editor.commands.undo();
    const citationUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeCitationJson;

    const paragraphPositions = positionsOf(editor.state.doc, "paragraph");
    const scrollParagraphPos = paragraphPositions.at(-1)!;
    const scrollParagraph = editor.state.doc.nodeAt(scrollParagraphPos);
    const scrollTargetPos = scrollParagraphPos + Math.max(
      1,
      (scrollParagraph?.content.size ?? 1) - 1,
    );
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, scrollTargetPos),
      ).scrollIntoView(),
    );
    await waitForCondition(
      "scroll-to-caret to reveal the authored target",
      () => {
        const coords = editor.view.coordsAtPos(scrollTargetPos);
        return editor.state.selection.head === scrollTargetPos &&
          coords.top >= 0 && coords.bottom <= globalThis.innerHeight;
      },
      30,
    );
    const scrolledCaretCoords = editor.view.coordsAtPos(scrollTargetPos);
    const scrollToCaretProven = globalThis.scrollY > 0 &&
      scrolledCaretCoords.top >= 0 &&
      scrolledCaretCoords.bottom <= globalThis.innerHeight;

    const beforeUndoJson = JSON.stringify(editor.getJSON());
    editor.view.dispatch(editor.state.tr.insertText("Z", lineGapPos + 2));
    setDisposablePaginationProofPlan(editor, {
      epoch: 2,
      gaps: [{ kind: "line", pos: lineGapPos, height: 180 }],
    });
    const undoAccepted = editor.commands.undo();
    const afterUndoJson = JSON.stringify(editor.getJSON());

    const rowPositions = positionsOf(editor.state.doc, "tableRow");
    setDisposablePaginationProofPlan(editor, {
      epoch: 3,
      gaps: [{
        kind: "tableRow",
        pos: rowPositions[3]!,
        height: 180,
        columns: 3,
      }],
    });
    await frame();
    const gapRow = requireElement<HTMLTableRowElement>(
      "tr[data-pagination-proof-gap='tableRow']",
    );
    const rowBefore = gapRow.previousElementSibling?.getBoundingClientRect();
    const rowAfter = gapRow.nextElementSibling?.getBoundingClientRect();
    const tableGapParentTag = gapRow.parentElement?.tagName ?? "none";
    const tableGapPreviousTag = gapRow.previousElementSibling?.tagName ??
      "none";
    const tableGapNextTag = gapRow.nextElementSibling?.tagName ?? "none";
    const validTableRowStructure = tableGapParentTag === "TBODY" &&
      gapRow.cells.length === 1 && gapRow.cells[0]?.colSpan === 3;
    const tableGapMeasurement = await paginationMeasurer.read({
      epoch: 3,
      signal: new AbortController().signal,
      latestEpoch: () => 3,
    });
    if (tableGapMeasurement.status !== "measured") {
      throw new Error("Table-gap production measurement was stale");
    }
    const tableGapFragments = tableGapMeasurement.fragments.filter(
      (fragment) =>
        fragment.from >= firstTablePos &&
        fragment.to <= firstTablePos + firstTableNode.nodeSize,
    );
    const tableGapMeasurementsNormalized = samePlannerFragmentInputs(
      firstTableFragments,
      tableGapFragments,
    );

    const figurePos = positionsOf(editor.state.doc, "figure")[0]!;
    setDisposablePaginationProofPlan(editor, {
      epoch: 4,
      gaps: [{ kind: "block", pos: figurePos, height: 180 }],
    });
    await frame();
    const blockGap = requireElement<HTMLElement>(
      "[data-pagination-proof-gap='block']",
    );
    const figure = requireElement<HTMLElement>("[data-apa-figure]");
    const blockGapRect = blockGap.getBoundingClientRect();
    const figureRect = figure.getBoundingClientRect();
    const figureGapParentTag = blockGap.parentElement?.tagName ?? "none";
    const figureGapNextTag = blockGap.nextElementSibling?.tagName ?? "none";
    const atomicFigureStructure = blockGap.nextElementSibling === figure &&
      figure.querySelectorAll(".fig-img").length === 1;

    let deletionReplanCount = 0;
    let authoredMutationPhase: "delete" | "undo" | null = null;
    let mappedGapCountAfterDeletion = -1;
    let postDeleteDerivedGapCount = -1;
    let postUndoDerivedGapCount = -1;
    editor.on("transaction", ({ transaction }) => {
      if (authoredMutationPhase !== "delete" || !transaction.docChanged) {
        return;
      }
      mappedGapCountAfterDeletion =
        disposablePaginationProofKey.getState(editor.state)?.gaps.length ?? -1;
    });
    const replanTrailingFigure = () => {
      if (authoredMutationPhase === null) return;
      deletionReplanCount += 1;
      const derivedPlan = deriveTrailingFigurePlan(
        editor.state.doc,
        5 + deletionReplanCount,
      );
      if (authoredMutationPhase === "delete") {
        postDeleteDerivedGapCount = derivedPlan.gaps.length;
      } else {
        postUndoDerivedGapCount = derivedPlan.gaps.length;
      }
      setDisposablePaginationProofPlan(editor, derivedPlan);
    };
    editor.on("update", replanTrailingFigure);

    const trailingFigurePos = positionsOf(editor.state.doc, "figure")[1]!;
    const trailingFigure = editor.state.doc.nodeAt(trailingFigurePos);
    if (trailingFigure?.type.name !== "figure") {
      throw new Error("The trailing authored figure was not found");
    }
    const initialTrailingPlan = deriveTrailingFigurePlan(editor.state.doc, 5);
    setDisposablePaginationProofPlan(editor, initialTrailingPlan);
    await waitForCondition(
      "the trailing-page gap before the final authored figure",
      () => !!document.querySelector("[data-pagination-proof-gap='block']"),
    );
    const beforeDeletionJson = JSON.stringify(editor.getJSON());
    const heightWithTrailingPage = await waitForStableMeasurement(
      "the body height with its trailing page",
      () => body.getBoundingClientRect().height,
    );

    authoredMutationPhase = "delete";
    editor.view.dispatch(
      editor.state.tr.delete(
        trailingFigurePos,
        trailingFigurePos + trailingFigure.nodeSize,
      ),
    );
    authoredMutationPhase = null;
    await waitForCondition(
      "derived replanning to remove the empty trailing-page gap",
      () =>
        deletionReplanCount === 1 && postDeleteDerivedGapCount === 0 &&
        !document.querySelector("[data-pagination-proof-gap]"),
    );
    const trailingGapRemovedAfterDelete = !document.querySelector(
      "[data-pagination-proof-gap]",
    );
    const afterDeletionJson = JSON.stringify(editor.getJSON());
    const figuresAfterDeletion = positionsOf(editor.state.doc, "figure")
      .length;
    const heightWithoutTrailingPage = await waitForStableMeasurement(
      "the body height after authored deletion and replanning",
      () => body.getBoundingClientRect().height,
    );
    authoredMutationPhase = "undo";
    const deletionUndoAccepted = editor.commands.undo();
    authoredMutationPhase = null;
    await waitForCondition(
      "one undo to restore the authored trailing figure and its derived gap",
      () =>
        JSON.stringify(editor.getJSON()) === beforeDeletionJson &&
        postUndoDerivedGapCount === 1 &&
        !!document.querySelector("[data-pagination-proof-gap='block']"),
      30,
    );
    const deletionUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeDeletionJson;
    const trailingGapRestoredAfterUndo = !!document.querySelector(
      "[data-pagination-proof-gap='block']",
    );
    editor.off("update", replanTrailingFigure);

    const derivedJsonIdentity =
      JSON.stringify(editor.getJSON()) === initialJson;
    paginationMeasurer.destroy();
    paginationMeasurer = undefined;
    editor.destroy();
    mount.replaceChildren();

    const productionReports: PaginationStateReport[] = [];
    let productionReferenceCount = 1;
    const productionReferenceEnv: ReferenceDecorationEnv = {
      references: fixture.references,
      locale: "en" as const,
      emptyLabel: "unused",
      onPageCountChange: (count: number) => {
        productionReferenceCount = count;
      },
    };
    const productionPaginationEnv = {
      reason: "canonical-layout" as const,
      getReferencePageCount: () => productionReferenceCount,
      onPageCount: (report: PaginationStateReport) => {
        productionReports.push(report);
        const plan = report.visiblePlan ?? report.lastStablePlan;
        if (!productionEditor || !plan || !report.pageCount) return;
        const composition = composeDocumentPages({
          authoredPageStarts: plan.pageStarts,
          referencePageCount: report.pageCount.references,
          documentEnd: productionEditor.state.doc.content.size,
        });
        productionReferenceEnv.pageNumbers = composition.pages
          .filter((page) => page.kind === "references")
          .map((page) => page.pageNumber);
        repaintReferenceDecoration(productionEditor);
      },
    };
    productionEditor = createTesinaEditor({
      element: mount,
      content: fixture.content,
      newlyCreated: true,
      citationEnv: {
        refsById: new Map(
          fixture.references.map((reference) => [reference.id, reference]),
        ),
        locale: "en",
      },
      referenceEnv: productionReferenceEnv,
      paginationEnv: productionPaginationEnv,
    });
    const productionJson = JSON.stringify(productionEditor.getJSON());
    const productionStableFrames = await waitForCondition(
      "the production pagination and references stack to settle",
      () =>
        productionReports.some((report) => report.status === "stable") &&
        !!mount.querySelector("[data-reference-page-number]") &&
        !!mount.querySelector("[data-pagination-page-number]"),
      240,
    );
    const firstProductionStable = productionReports.findLast((report) =>
      report.status === "stable"
    )!;
    const firstProductionPlan = firstProductionStable.visiblePlan ??
      firstProductionStable.lastStablePlan!;
    const productionComposition = composeDocumentPages({
      authoredPageStarts: firstProductionPlan.pageStarts,
      referencePageCount: firstProductionStable.pageCount!.references,
      documentEnd: productionEditor.state.doc.content.size,
    });
    const productionNumbers = [
      ...mount.querySelectorAll<HTMLElement>(".tesina-page-number"),
    ];
    const expectedProductionNumbers = productionComposition.pages
      .slice(1)
      .map((page) => page.pageNumber);
    const productionPageChromeSequential = productionNumbers.map((number) =>
      Number(number.textContent)
    ).join(",") === expectedProductionNumbers.join(",");
    const productionPageChromeInert = productionNumbers.every((number) =>
      number.contentEditable === "false" &&
      number.getAttribute("aria-hidden") === "true" && number.tabIndex === -1
    );
    const productionReferences = mount.querySelector(
      "[data-reference-pages]",
    );
    const productionAppendix = mount.querySelector("[data-sec='appendix']");
    const productionReferencesBeforeAppendix = !!productionReferences &&
      !!productionAppendix &&
      (productionReferences.compareDocumentPosition(productionAppendix) &
          Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    const proofEditor = requireElement<HTMLElement>("#proof-editor");
    const unscaledEditorRect = productionEditor.view.dom
      .getBoundingClientRect();
    const scaledLayout = calculatePaperScale(612, proofEditor.scrollHeight);
    proofEditor.style.transformOrigin = "top left";
    proofEditor.style.transform = `scale(${scaledLayout.scale})`;
    shell.style.width = `${scaledLayout.outerWidth + 48}px`;
    shell.style.height = `${scaledLayout.outerHeight + 48}px`;
    const scaledEpoch = firstProductionStable.epoch + 1;
    invalidatePagination(productionEditor, "canonical-layout");
    const productionScaledFrames = await waitForCondition(
      "production pagination to settle under the compensated transform",
      () =>
        productionReports.some((report) =>
          report.status === "stable" && report.epoch >= scaledEpoch
        ),
      240,
    );
    const scaledProductionStable = productionReports.findLast((report) =>
      report.status === "stable" && report.epoch >= scaledEpoch
    )!;
    const scaledEditorRect = productionEditor.view.dom.getBoundingClientRect();
    const productionTargetPos = positionsOf(
      productionEditor.state.doc,
      "paragraph",
    ).at(-1)! + 1;
    productionEditor.view.dispatch(
      productionEditor.state.tr.setSelection(
        TextSelection.create(productionEditor.state.doc, productionTargetPos),
      ).scrollIntoView(),
    );
    await frame();
    const scaledCaret = productionEditor.view.coordsAtPos(productionTargetPos);
    const scaledHit = productionEditor.view.posAtCoords({
      left: scaledCaret.left,
      top: (scaledCaret.top + scaledCaret.bottom) / 2,
    });
    const transformedHitTesting = scaledHit !== null &&
      Math.abs(scaledHit.pos - productionTargetPos) <= 1 &&
      productionEditor.state.selection.head === productionTargetPos;
    const productionScaleInvariantCount = JSON.stringify(
      scaledProductionStable.pageCount,
    ) === JSON.stringify(firstProductionStable.pageCount);
    const observedVisualScale = scaledEditorRect.width /
      unscaledEditorRect.width;
    const visualScaleApplied = Math.abs(
      observedVisualScale - scaledLayout.scale,
    ) < 0.01;
    const productionJsonIdentity =
      JSON.stringify(productionEditor.getJSON()) ===
        productionJson;

    productionEditor.destroy();
    productionEditor = undefined;
    mount.replaceChildren();
    proofEditor.style.transform = "";
    shell.style.width = "864px";
    shell.style.height = "";

    const nativeWorkloads: NativePaginationWorkloadResult[] = [];
    for (const targetPages of [10, 25, 50] as const) {
      diagnostic("native-performance-workload-start", { targetPages });
      const workload = await runNativePerformanceWorkload(
        targetPages,
        mount,
        shell,
        proofEditor,
        fixture,
      );
      const evaluation = evaluateNativePaginationWorkload(workload);
      diagnostic("native-performance-workload-complete", {
        targetPages,
        evaluation,
        workload,
      });
      nativeWorkloads.push(workload);
    }
    const nativeWorkloadEvaluations = nativeWorkloads.map((workload) =>
      evaluateNativePaginationWorkload(workload)
    );

    shell.style.setProperty(
      "--doc-font",
      '"Times New Roman", Times, Georgia, serif',
    );
    shell.style.setProperty("--doc-font-size", "12pt");
    const parityFixture = createStablePaginationParityFixture("en");
    const parityReports: PaginationStateReport[] = [];
    let parityReferenceCount = 1;
    const parityReferenceEnv: ReferenceDecorationEnv = {
      references: parityFixture.references,
      locale: "en",
      emptyLabel: "unused",
      onPageCountChange: (count: number) =>
        parityReferenceCount = count,
    };
    const parityPaginationEnv = {
      reason: "canonical-layout" as const,
      getReferencePageCount: () => parityReferenceCount,
      onPageCount: (report: PaginationStateReport) => {
        parityReports.push(report);
        const plan = report.visiblePlan ?? report.lastStablePlan;
        if (!parityEditor || !plan || !report.pageCount) return;
        const composition = composeDocumentPages({
          authoredPageStarts: plan.pageStarts,
          referencePageCount: report.pageCount.references,
          documentEnd: parityEditor.state.doc.content.size,
        });
        parityReferenceEnv.pageNumbers = composition.pages
          .filter((page) => page.kind === "references")
          .map((page) => page.pageNumber);
        repaintReferenceDecoration(parityEditor);
      },
    };
    parityEditor = createTesinaEditor({
      element: mount,
      content: parityFixture.content,
      newlyCreated: true,
      citationEnv: {
        refsById: new Map(
          parityFixture.references.map((reference) => [
            reference.id,
            reference,
          ]),
        ),
        locale: "en",
      },
      referenceEnv: parityReferenceEnv,
      paginationEnv: parityPaginationEnv,
    });
    const parityStableFrames = await waitForCondition(
      "the stable live/Paged parity fixture",
      () => parityReports.some((report) => report.status === "stable"),
      240,
    );
    const parityEssay = createEmptyEssay(
      "en",
      "2026-08-08T12:00:00.000Z",
    );
    parityEssay.titlePage.title =
      "A Synthetic Archive Study of Community Seed Records, Seasonal Rainfall, Volunteer Checks, Envelope Labels, and Long-Term Planning Across Several Invented Coastal Districts";
    parityEssay.content = parityFixture.content;
    parityEssay.referencesSnapshot = parityFixture.references;
    const previewContainer = requireElement<HTMLElement>("#proof-preview");
    const { Previewer } = await import("pagedjs");
    const captureParity = async (
      font: "times-new-roman-12" | "georgia-11",
      cssStack: string,
      expectedFamily: string,
      expectedSizePt: number,
      invalidate: boolean,
    ) => {
      shell.style.setProperty("--doc-font", cssStack);
      shell.style.setProperty("--doc-font-size", `${expectedSizePt}pt`);
      parityEssay.settings.font = font;
      if (invalidate) {
        const targetEpoch =
          (paginationPluginKey.getState(parityEditor!.state)?.epoch ?? 0) + 1;
        invalidatePagination(parityEditor!, "font");
        await waitForCondition(
          `${expectedFamily} live pagination parity`,
          () =>
            parityReports.some((report) =>
              report.status === "stable" && report.epoch >= targetEpoch
            ),
          240,
        );
      }
      const stable = latestStableReport(parityReports);
      const plan = stable?.visiblePlan ?? stable?.lastStablePlan;
      if (!stable?.pageCount || !plan) {
        throw new Error(`${expectedFamily} live parity plan is unavailable`);
      }
      const composition = composeDocumentPages({
        authoredPageStarts: plan.pageStarts,
        referencePageCount: stable.pageCount.references,
        documentEnd: parityEditor!.state.doc.content.size,
      });
      previewContainer.replaceChildren();
      const styleUrl = URL.createObjectURL(
        new Blob([renderEssayCss(parityEssay.settings)], { type: "text/css" }),
      );
      let previewFlow: Awaited<
        ReturnType<InstanceType<typeof Previewer>["preview"]>
      >;
      try {
        previewFlow = await new Previewer().preview(
          renderEssayHtml(
            parityEssay,
            parityFixture.content,
            parityFixture.references,
          ),
          [styleUrl],
          previewContainer,
        );
      } finally {
        URL.revokeObjectURL(styleUrl);
      }
      const previewPages = [
        ...previewContainer.querySelectorAll<HTMLElement>(".pagedjs_page"),
      ];
      const previewKinds = previewPages.map((page) => {
        if (page.querySelector(".title-page")) return "cover";
        if (page.querySelector("section.abstract")) return "abstract";
        if (page.querySelector("section.body-sec")) return "body";
        if (page.querySelector("section.references")) return "references";
        if (page.querySelector("section.appendix")) return "appendix";
        return "unknown";
      });
      const liveKinds = composition.pages.map((page) =>
        page.kind === "authored" ? page.section : page.kind
      );
      const firstPreviewPage = previewPages[0];
      const firstPreviewArea = firstPreviewPage?.querySelector<HTMLElement>(
        ".pagedjs_area",
      );
      const previewBodyParagraph = previewContainer.querySelector<HTMLElement>(
        "section.body-sec p",
      );
      const liveBodyParagraph = mount.querySelector<HTMLElement>(
        "[data-sec='body'] p",
      );
      if (
        !firstPreviewPage || !firstPreviewArea || !previewBodyParagraph ||
        !liveBodyParagraph
      ) {
        throw new Error(`${expectedFamily} parity DOM is incomplete`);
      }
      const livePage = parityEditor!.view.dom;
      const livePageRect = livePage.getBoundingClientRect();
      const livePageStyle = getComputedStyle(livePage);
      const previewPageRect = firstPreviewPage.getBoundingClientRect();
      const previewAreaRect = firstPreviewArea.getBoundingClientRect();
      const previewTextStyle = getComputedStyle(previewBodyParagraph);
      const liveTextStyle = getComputedStyle(liveBodyParagraph);
      const livePaddingTop = Number.parseFloat(livePageStyle.paddingTop);
      const livePaddingRight = Number.parseFloat(livePageStyle.paddingRight);
      const livePaddingBottom = Number.parseFloat(livePageStyle.paddingBottom);
      const livePaddingLeft = Number.parseFloat(livePageStyle.paddingLeft);
      const livePageMinHeight = Number.parseFloat(livePageStyle.minHeight);
      const geometry = {
        livePageWidth: livePageRect.width,
        livePageMinHeight,
        livePaddingTop,
        livePaddingRight,
        livePaddingBottom,
        livePaddingLeft,
        livePrintableWidth: livePageRect.width - livePaddingLeft -
          livePaddingRight,
        livePrintableHeight: livePageMinHeight - livePaddingTop -
          livePaddingBottom,
        previewPageWidth: previewPageRect.width,
        previewPageHeight: previewPageRect.height,
        previewMarginTop: previewAreaRect.top - previewPageRect.top,
        previewMarginLeft: previewAreaRect.left - previewPageRect.left,
        previewPrintableWidth: previewAreaRect.width,
        previewPrintableHeight: previewAreaRect.height,
        expectedFontFamily: expectedFamily,
        expectedFontSizePt: expectedSizePt,
        liveFontFamily: liveTextStyle.fontFamily,
        previewFontFamily: previewTextStyle.fontFamily,
        liveFontSize: Number.parseFloat(liveTextStyle.fontSize),
        previewFontSize: Number.parseFloat(previewTextStyle.fontSize),
        liveLineHeight: Number.parseFloat(liveTextStyle.lineHeight),
        previewLineHeight: Number.parseFloat(previewTextStyle.lineHeight),
      };
      return {
        pageParity: previewFlow.total === composition.total &&
          previewPages.length === composition.total &&
          previewKinds.join(",") === liveKinds.join(","),
        geometry,
        geometryEvaluation: evaluateLivePagedGeometry(geometry),
        exactLiveStatusCount:
          composition.total === stable.pageCount.total + 1 &&
          mount.querySelectorAll(".tesina-page-number").length ===
            composition.total - 1,
        livePageCount: composition.total,
        previewPageCount: previewFlow.total,
        liveSections: liveKinds.join(","),
        previewSections: previewKinds.join(","),
      };
    };

    const timesParity = await captureParity(
      "times-new-roman-12",
      '"Times New Roman", Times, Georgia, serif',
      "Times New Roman",
      12,
      false,
    );
    const georgiaParity = await captureParity(
      "georgia-11",
      'Georgia, "Times New Roman", serif',
      "Georgia",
      11,
      true,
    );

    const checks = {
      productionDomMapping: initialMeasurement.fragments.some((fragment) =>
        fragment.id.startsWith("section:") && fragment.kind === "heading" &&
        fragment.height > 0
      ) &&
        paragraphLines.every((fragment) =>
          fragment.from >= paragraphPos &&
          fragment.to <= paragraphPos +
              (editor.state.doc.nodeAt(paragraphPos)?.nodeSize ?? 0)
        ) &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.kind === "listItem"
          ).length >= 3 &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.kind === "tableRow"
          ).length === positionsOf(editor.state.doc, "tableRow").length &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.id.startsWith("figure:") && fragment.kind === "atomic"
          ).length === positionsOf(editor.state.doc, "figure").length &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.id.startsWith("apaEquation:") &&
            fragment.kind === "atomic"
          ).length === positionsOf(editor.state.doc, "apaEquation").length,
      generatedSectionHeadingMeasured:
        generatedHeadingMeasurementMatchesVisualSpan,
      tableWrapperMarginsMeasured,
      adjacentAtomicMarginsMeasuredOnce,
      runInHeadingMeasuredOnce: runInMeasurementMatchesVisualSpan,
      tableContinuationHeaderMeasured:
        tableFragments[0]?.table?.repeatedHeader === undefined &&
        repeatedTableHeader !== undefined && repeatedTableHeader.height > 0 &&
        repeatedTableHeader.cells.map((cell) => cell.text).join("|") ===
          "Round|Cards|Envelopes" &&
        repeatedTableHeader.cells.reduce(
            (columns, cell) => columns + cell.colSpan,
            0,
          ) === 3,
      existingDecorationsNormalized,
      tableGapMeasurementsNormalized,
      authoredDeletionReflow: initialTrailingPlan.gaps.length === 1 &&
        deletionReplanCount === 2 && mappedGapCountAfterDeletion === 1 &&
        postDeleteDerivedGapCount === 0 && trailingGapRemovedAfterDelete &&
        afterDeletionJson !== beforeDeletionJson &&
        figuresAfterDeletion === 1 &&
        positionsOf(editor.state.doc, "figure").length === 2 &&
        postUndoDerivedGapCount === 1 && trailingGapRestoredAfterUndo &&
        deletionUndoAccepted && deletionUndoRestored &&
        heightWithTrailingPage.value - heightWithoutTrailingPage.value >= 170,
      caretInputTraversal: caretStartPos !== null &&
        caretStartPos < lineGapPos &&
        caretAfterTraversal !== null && caretAfterTraversal > lineGapPos &&
        caretAfterTraversalCoords.top >= firstPlannedGap.bottom &&
        caretMoveCount > 0 && caretStayedFocused &&
        caretEndpointInAuthoredText && nativeInputAccepted &&
        nativeInputEventCount >= 1 && nativeInputChangedJson &&
        nativeInputInsertedAtTraversal &&
        nativeCaretAfterInputPosition === nativeInputPosition + 1 &&
        nativeInputUndoAccepted && nativeInputUndoRestored,
      conditionalFirstPaint,
      oneEditorView: document.querySelectorAll(".ProseMirror").length === 1,
      derivedJsonIdentity,
      lineLevelContinuation: lineGapInsideParagraph &&
        afterCaret.top - beforeCaret.bottom >= 170,
      caretAcrossGap: beforeCaret.top < firstPlannedGap.top &&
        afterCaret.top >= firstPlannedGap.bottom,
      selectionAcrossGap: selectionAcrossGapProven,
      formattingAcrossGap: formattingAccepted &&
        formattingAppliedAcrossGap && formattingUndoAccepted &&
        formattingUndoRestored && formattingRedoAccepted &&
        formattingRedoRestored && formattingFinalUndoAccepted &&
        formattingFinalUndoRestored,
      citationAcrossGap: citationInsertedBeyondGap && citationUndoAccepted &&
        citationUndoRestored,
      scrollToCaret: scrollToCaretProven,
      oneStepUndo: undoAccepted && afterUndoJson === beforeUndoJson,
      validTableRowGap: validTableRowStructure &&
        !!rowBefore && !!rowAfter && rowAfter.top - rowBefore.bottom >= 170,
      atomicFigureMovement: atomicFigureStructure &&
        figureRect.top >= blockGapRect.bottom &&
        figure.querySelectorAll(".fig-img").length === 1,
      trailingPageRemoval: trailingGapRemovedAfterDelete &&
        heightWithTrailingPage.value - heightWithoutTrailingPage.value >= 170,
      stableFirstPaint: conditionalFirstPaint,
      visualGapIsReal: firstPlannedGap.height >= 179 &&
        firstPlannedGap.width >= 815,
      productionPaginationStack: productionComposition.total ===
          firstProductionStable.pageCount!.total + 1 &&
        productionPageChromeSequential && productionReferencesBeforeAppendix,
      productionPageChromeInert,
      productionScaleInvariantCount,
      productionJsonIdentity,
      transformedHitTesting,
      visualScaleApplied,
      nativeRenderedPerformance: nativeWorkloadEvaluations.every((result) =>
        result.passed
      ),
      previewPagedParity: timesParity.pageParity && georgiaParity.pageParity,
      livePagedLetterGeometry: timesParity.geometryEvaluation.passed &&
        georgiaParity.geometryEvaluation.passed,
      tnr12TypeParity:
        timesParity.geometryEvaluation.checks.selectedCanonicalFont &&
        timesParity.geometryEvaluation.checks.doubleSpacing &&
        timesParity.geometryEvaluation.checks.rendererTypeParity,
      georgia11TypeParity:
        georgiaParity.geometryEvaluation.checks.selectedCanonicalFont &&
        georgiaParity.geometryEvaluation.checks.doubleSpacing &&
        georgiaParity.geometryEvaluation.checks.rendererTypeParity,
      exactLiveStatusCount: timesParity.exactLiveStatusCount &&
        georgiaParity.exactLiveStatusCount,
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      passed,
      engine: navigator.userAgent,
      checks,
      metrics: {
        measuredParagraphLines: starts.length,
        measuredFragments: initialMeasurement.fragments.length,
        measuredListLines: initialMeasurement.fragments.filter((fragment) =>
          fragment.kind === "listItem"
        ).length,
        measuredTableRows: initialMeasurement.fragments.filter((fragment) =>
          fragment.kind === "tableRow"
        ).length,
        measuredFigures: initialMeasurement.fragments.filter((fragment) =>
          fragment.id.startsWith("figure:")
        ).length,
        measuredEquations: initialMeasurement.fragments.filter((fragment) =>
          fragment.id.startsWith("apaEquation:")
        ).length,
        generatedHeadingVisualHeight,
        generatedHeadingMeasuredHeight,
        firstTableVisualHeight,
        firstTableMeasuredHeight,
        adjacentAtomicVisualAdvance,
        adjacentAtomicMeasuredAdvance,
        measuredRunInHeight,
        runInVisualHeight,
        runInClientRectCount: runInRects.length,
        runInPositiveAreaRectCount,
        repeatedTableHeaderHeight: repeatedTableHeader?.height ?? 0,
        resourceWaitFrames,
        gapWaitFrames,
        hiddenStableFrames: hiddenStableLayout.frames,
        visibleStableFrames: visibleStableLayout.frames,
        resizeRevisionAtReveal,
        resizeRevisionAtFirstVisiblePaint: firstVisibleLayout.resizeRevision,
        resizeRevisionAtVisibleStability:
          visibleStableLayout.snapshot.resizeRevision,
        lineGapPosition: lineGapPos,
        caretVerticalSeparation: afterCaret.top - beforeCaret.bottom,
        caretStartPosition: caretStartPos ?? -1,
        caretAfterTraversalPosition: caretAfterTraversal ?? -1,
        caretMoveCount,
        scrollTargetPosition: scrollTargetPos,
        scrollTargetTop: scrolledCaretCoords.top,
        scrollY: globalThis.scrollY,
        caretAfterTraversalTop: caretAfterTraversalCoords.top,
        requestedVisualScale: scaledLayout.scale,
        observedVisualScale,
        scaledHitPosition: scaledHit?.pos ?? -1,
        productionStableFrames,
        productionScaledFrames,
        productionPageCount: productionComposition.total,
        productionJsonIdentity: String(productionJsonIdentity),
        parityStableFrames,
        nativeRuntimeIdentity: JSON.stringify({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          vendor: navigator.vendor,
          language: navigator.language,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: (navigator as Navigator & { deviceMemory?: number })
            .deviceMemory ?? "unavailable",
          devicePixelRatio: globalThis.devicePixelRatio,
          screenWidth: globalThis.screen.width,
          screenHeight: globalThis.screen.height,
        }),
        nativeWorkload10: JSON.stringify(nativeWorkloads[0]),
        nativeWorkload25: JSON.stringify(nativeWorkloads[1]),
        nativeWorkload50: JSON.stringify(nativeWorkloads[2]),
        nativeInputP95_10: percentile95(
          nativeWorkloads[0]?.inputDurationsMs ?? [],
        ),
        nativeInputP95_25: percentile95(
          nativeWorkloads[1]?.inputDurationsMs ?? [],
        ),
        nativeInputP95_50: percentile95(
          nativeWorkloads[2]?.inputDurationsMs ?? [],
        ),
        timesParity: JSON.stringify(timesParity),
        georgiaParity: JSON.stringify(georgiaParity),
        nativeInputAccepted: String(nativeInputAccepted),
        nativeInputEventCount,
        nativeInputPosition,
        nativeCaretAfterInputPosition,
        lineGapHeight: firstPlannedGap.height,
        lineGapParentTag,
        tableGapSeparation: rowBefore && rowAfter
          ? rowAfter.top - rowBefore.bottom
          : -1,
        tableGapParentTag,
        tableGapCells: gapRow.cells.length,
        tableGapColSpan: gapRow.cells[0]?.colSpan ?? -1,
        tableGapPreviousTag,
        tableGapNextTag,
        tableGapHtml: gapRow.outerHTML,
        figureHeight: figureRect.height,
        figureGapParentTag,
        figureGapNextTag,
        figureImageCount: figure.querySelectorAll(".fig-img").length,
        figureGapBottom: blockGapRect.bottom,
        figureTop: figureRect.top,
        deletionReplanCount,
        mappedGapCountAfterDeletion,
        postDeleteDerivedGapCount,
        postUndoDerivedGapCount,
        figuresAfterDeletion,
        trailingHeightWithPage: heightWithTrailingPage.value,
        trailingHeightWithoutPage: heightWithoutTrailingPage.value,
        trailingHeightRemoved: heightWithTrailingPage.value -
          heightWithoutTrailingPage.value,
        trailingPlanStableFrames: heightWithTrailingPage.frames,
        trailingReflowStableFrames: heightWithoutTrailingPage.frames,
      },
      ...(passed ? {} : { error: "One or more WKWebView proof checks failed" }),
    };
  } finally {
    paginationMeasurer?.destroy();
    productionEditor?.destroy();
    parityEditor?.destroy();
    editor.destroy();
  }
}

const resultElement = requireElement<HTMLElement>("#proof-result");
let proofFinished = false;
const watchdog = startProofPageWatchdog(
  AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationPage,
  () => {
    finishProof({
      passed: false,
      engine: navigator.userAgent,
      checks: {},
      metrics: {},
      error: "Pagination proof page watchdog expired",
    });
  },
);

function finishProof(result: ProofResult): void {
  if (proofFinished) return;
  proofFinished = true;
  watchdog.cancel();
  resultElement.textContent = JSON.stringify(result, null, 2);
  nativeBridge.postResult(result);
}

runProof().then((result) => {
  diagnostic("proof-result", { passed: result.passed });
  finishProof(result);
}).catch((error: unknown) => {
  diagnostic("proof-catch", {
    error: error instanceof Error ? error.message : String(error),
  });
  const result: ProofResult = {
    passed: false,
    engine: navigator.userAgent,
    checks: {},
    metrics: {},
    error: error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error),
  };
  finishProof(result);
});
