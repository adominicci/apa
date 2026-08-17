import { m } from "$lib/paraglide/messages";
import type { ApaCheckIssue } from "@tesina/engine";

/** UI-locale text for a live APA check issue (chrome surface). */
export function localizeApaCheck(issue: ApaCheckIssue): string {
  switch (issue.rule) {
    case "empty-paragraph":
      return m.apa_check_empty_paragraph();
    case "skipped-heading-level":
      return m.apa_check_skipped_heading({
        found: issue.found ?? 0,
        allowed: issue.allowed ?? 1,
      });
    case "empty-table-title":
      return m.apa_check_empty_table_title();
    case "empty-figure-title":
      return m.apa_check_empty_figure_title();
  }
}
