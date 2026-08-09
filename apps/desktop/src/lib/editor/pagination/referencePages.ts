export interface MeasuredReferenceEntry {
  key: string;
  height: number;
}

export interface ReferencePagePlan {
  pages: Array<{
    index: number;
    entryKeys: string[];
    overflowKeys: string[];
  }>;
  pageCount: number;
}

const PRINTABLE_HEIGHT = 864;

function measuredHeight(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function planReferencePages(input: {
  headingHeight: number;
  entries: readonly MeasuredReferenceEntry[];
}): ReferencePagePlan {
  const pages: ReferencePagePlan["pages"] = [{
    index: 0,
    entryKeys: [],
    overflowKeys: [],
  }];
  let usedHeight = measuredHeight(input.headingHeight);

  for (const entry of input.entries) {
    const height = measuredHeight(entry.height);
    let page = pages.at(-1)!;
    const available = Math.max(0, PRINTABLE_HEIGHT - usedHeight);

    if (height > available && usedHeight > 0) {
      page = {
        index: pages.length,
        entryKeys: [],
        overflowKeys: [],
      };
      pages.push(page);
      usedHeight = 0;
    }

    page.entryKeys.push(entry.key);
    if (height > Math.max(0, PRINTABLE_HEIGHT - usedHeight)) {
      page.overflowKeys.push(entry.key);
    }
    usedHeight += Math.min(height, PRINTABLE_HEIGHT);
  }

  return { pages, pageCount: pages.length };
}
