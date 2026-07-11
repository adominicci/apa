declare module "pagedjs" {
  export interface PagedFlow {
    total: number;
  }
  export class Previewer {
    preview(
      content: string,
      stylesheets: string[],
      renderTo: HTMLElement,
    ): Promise<PagedFlow>;
  }
}
