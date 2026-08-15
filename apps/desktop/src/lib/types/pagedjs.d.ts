declare module "pagedjs" {
  export interface PagedFlow {
    total: number;
  }
  export interface PagedPolisher {
    /** The base stylesheet inserted by `setup()`. */
    base?: HTMLStyleElement;
    /** CSSOM-only sheet Paged.js writes runtime counter rules into. */
    styleSheet?: CSSStyleSheet;
    /** Every `<style>` element this polisher appended to `document.head`. */
    inserted: HTMLStyleElement[];
    /** Removes exactly the elements this polisher inserted. */
    destroy(): void;
  }
  export class Previewer {
    polisher: PagedPolisher;
    preview(
      content: string,
      stylesheets: string[],
      renderTo: HTMLElement,
    ): Promise<PagedFlow>;
  }
}
