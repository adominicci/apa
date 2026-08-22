export type VariantKey = "A" | "B" | "C";

export interface PrototypeState {
  uiLocale: "en" | "es";
  documentLanguage: "en" | "es";
  spelling: {
    word: "oracionn" | "oración";
    status: "issue" | "corrected";
  };
  coach: {
    category: "specificity";
    status: "unread" | "reflecting" | "revised";
  };
  localAi: {
    status: "not-installed" | "consent" | "ready" | "reviewed";
  };
  quiz: {
    status: "idle" | "question" | "answered";
    selectedOption: number | null;
  };
  lastAction: string;
}

export interface PrototypeActions {
  applySuggestion: () => void;
  openCoach: () => void;
  markRevised: () => void;
  advanceLocalAi: () => void;
  startQuiz: () => void;
  selectQuizOption: (index: number) => void;
  submitQuiz: () => void;
  reset: () => void;
}

export const VARIANT_LABELS: Record<VariantKey, string> = {
  A: "Margin guide",
  B: "Learning ribbon",
  C: "Study workspace",
};

export function createInitialState(): PrototypeState {
  return {
    uiLocale: "en",
    documentLanguage: "es",
    spelling: { word: "oracionn", status: "issue" },
    coach: { category: "specificity", status: "unread" },
    localAi: { status: "not-installed" },
    quiz: { status: "idle", selectedOption: null },
    lastAction: "Prototype opened",
  };
}
