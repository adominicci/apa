export interface PaperScaleLayout {
  layoutWidth: number;
  scale: number;
  outerWidth: number;
  outerHeight: number;
}

export interface PaperScaleObserver {
  observe(element: Element): void;
  disconnect(): void;
}

export type PaperScaleObserverFactory = (
  callback: () => void,
) => PaperScaleObserver;

export function calculatePaperScale(
  availableWidth: number,
  stackHeight: number,
): PaperScaleLayout {
  const layoutWidth = 816;
  const scale = Number.isFinite(availableWidth) && availableWidth > 0
    ? Math.min(1, availableWidth / layoutWidth)
    : 1;
  const normalizedHeight = Number.isFinite(stackHeight) && stackHeight > 0
    ? stackHeight
    : 0;

  return {
    layoutWidth,
    scale,
    outerWidth: layoutWidth * scale,
    outerHeight: normalizedHeight * scale,
  };
}

export function observePaperScale(
  viewport: HTMLElement,
  stack: HTMLElement,
  onLayout: (layout: PaperScaleLayout) => void,
  createObserver: PaperScaleObserverFactory = (callback) =>
    typeof ResizeObserver === "undefined"
      ? { observe: () => {}, disconnect: () => {} }
      : new ResizeObserver(callback),
): () => void {
  const update = () => {
    onLayout(calculatePaperScale(viewport.clientWidth, stack.scrollHeight));
  };
  const observer = createObserver(update);
  observer.observe(viewport);
  observer.observe(stack);
  update();
  return () => observer.disconnect();
}
