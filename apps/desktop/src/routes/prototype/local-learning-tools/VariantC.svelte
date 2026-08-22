<script lang="ts">
  import type { PrototypeActions, PrototypeState } from "./types";

  interface Props {
    state: PrototypeState;
    actions: PrototypeActions;
  }

  let { state: prototypeState, actions }: Props = $props();
  let mode = $state<"write" | "study">("study");
  let selectedLane = $state<"coach" | "ai" | "quiz">("coach");

  function setMode(next: typeof mode): void {
    mode = next;
    prototypeState.lastAction = `Switched workspace to ${next} mode`;
  }
</script>

<section class="study-workspace" aria-label="Variant C, study workspace">
  <header class="c-header">
    <div class="prototype-brand"><span class="prototype-mark">T</span><strong>Tesina</strong></div>
    <nav class="c-modes" aria-label="Workspace mode">
      <button class:active={mode === "write"} onclick={() => setMode("write")}>Write</button>
      <button class:active={mode === "study"} onclick={() => setMode("study")}>Study</button>
    </nav>
    <div class="c-header-meta"><span>La educación pública…</span><span class="prototype-locale">UI EN · DOC ES</span></div>
  </header>

  {#if mode === "write"}
    <main class="c-write-mode">
      <article class="mock-paper c-write-paper">
        <h1>La educación pública en Puerto Rico</h1>
        <p>La educación pública cumple una función esencial en el desarrollo de una <button class:corrected={prototypeState.spelling.status === "corrected"} class="mock-word" onclick={actions.applySuggestion}>{prototypeState.spelling.word}</button> académica capaz de responder a los cambios sociales.</p>
        <p>Sin embargo, <mark class="mock-highlight">es importante mejorar muchas cosas para lograr mejores resultados</mark>. Esta afirmación requiere una explicación más concreta.</p>
      </article>
      <button class="c-study-callout" onclick={() => setMode("study")}>
        <span>2 learning notes</span>
        <strong>Open study workspace</strong>
      </button>
    </main>
  {:else}
    <main class="c-study-mode">
      <section class="c-source-pane">
        <header><div><span>Source snapshot</span><strong>Paragraphs 1–3</strong></div><button onclick={() => setMode("write")}>Back to paper</button></header>
        <article class="c-source-copy">
          <h1>La educación pública en Puerto Rico</h1>
          <p>La educación pública cumple una función esencial en el desarrollo de una <button class:corrected={prototypeState.spelling.status === "corrected"} class="mock-word" onclick={actions.applySuggestion}>{prototypeState.spelling.word}</button> académica capaz de responder a los cambios sociales.</p>
          <p>Sin embargo, <mark class="mock-highlight">es importante mejorar muchas cosas para lograr mejores resultados</mark>. Esta afirmación requiere una explicación más concreta y evidencia que permita evaluarla.</p>
          <p>Los datos de matrícula y retención ofrecen un punto de partida para describir el problema sin atribuirlo a una sola causa.</p>
        </article>
        <footer>
          <span>Snapshot stays fixed during this study session.</span>
          {#if prototypeState.spelling.status === "issue"}<button class="mock-action" onclick={actions.applySuggestion}>Correct “oracionn”</button>{/if}
        </footer>
      </section>

      <section class="c-learning-pane">
        <header class="c-learning-head"><span>Private learning session</span><strong>Work with this passage</strong></header>
        <nav class="c-lanes" aria-label="Learning tools">
          <button class:active={selectedLane === "coach"} onclick={() => (selectedLane = "coach")}><span>Coach</span><small>Deterministic</small></button>
          <button class:active={selectedLane === "ai"} onclick={() => (selectedLane = "ai")}><span>Local AI</span><small>Optional</small></button>
          <button class:active={selectedLane === "quiz"} onclick={() => (selectedLane = "quiz")}><span>Quiz</span><small>Grounded</small></button>
        </nav>

        <div class="c-session">
          {#if selectedLane === "coach"}
            <span class="c-session-label">Specificity · Exact source highlighted</span>
            <h2>Make the claim testable</h2>
            <blockquote>“es importante mejorar muchas cosas para lograr mejores resultados”</blockquote>
            <p>What should improve, and which observable result would show that the change worked?</p>
            {#if prototypeState.coach.status === "reflecting"}
              <textarea aria-label="Student reflection" placeholder="Write your reasoning before revising"></textarea>
            {/if}
            <div class="c-session-actions">
              <button class="mock-action" onclick={actions.openCoach}>Write a reflection</button>
              <button class="mock-action primary" onclick={actions.markRevised}>Revise in paper</button>
            </div>
          {:else if selectedLane === "ai"}
            <span class="c-session-label">On-device · Selected text only</span>
            <h2>{prototypeState.localAi.status === "not-installed" ? "Local AI is optional" : "Review this selection"}</h2>
            <p>Spelling and the writing coach do not need a model. Install one only if you want a contextual second look at text you select.</p>
            <div class="c-privacy-lines"><span>No cloud fallback</span><span>No full-paper review</span><span>No authorship score</span></div>
            <button class="mock-action primary" onclick={actions.advanceLocalAi} disabled={prototypeState.localAi.status === "reviewed"}>{prototypeState.localAi.status === "not-installed" ? "Review setup and privacy" : prototypeState.localAi.status === "consent" ? "Install mock model" : "Review selection"}</button>
          {:else}
            {#if prototypeState.quiz.status === "idle"}
              <span class="c-session-label">Grounded in this source snapshot</span>
              <h2>Five questions, one answer each</h2>
              <p>Every answer and explanation points back to the selected passage. Nothing is saved after the session.</p>
              <button class="mock-action primary" onclick={actions.startQuiz}>Start study quiz</button>
            {:else}
              <span class="c-session-label">Question 1 of 5</span>
              <h2>What offers a starting point for describing the problem?</h2>
              <div class="c-options">
                {#each ["A single cause", "Enrollment and retention data", "A personal opinion", "The document title"] as option, index}
                  <button class:selected={prototypeState.quiz.selectedOption === index} class="mock-option" onclick={() => actions.selectQuizOption(index)}>{String.fromCharCode(65 + index)}. {option}</button>
                {/each}
              </div>
              {#if prototypeState.quiz.status === "question"}
                <button class="mock-action primary" disabled={prototypeState.quiz.selectedOption === null} onclick={actions.submitQuiz}>Submit answer</button>
              {:else}
                <div class="c-explanation"><strong>Enrollment and retention data</strong><p>The final source sentence names both as the starting point. Each other option lacks support in the snapshot.</p><button class="mock-action">View in source</button></div>
              {/if}
            {/if}
          {/if}
        </div>
      </section>
    </main>
  {/if}
</section>

<style>
  .study-workspace { min-height: 100vh; background: var(--bg); }
  .c-header { height: 58px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 22px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .c-modes { display: flex; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-pill); background: var(--bg); }
  .c-modes button { min-width: 82px; padding: 7px 14px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); font: 600 var(--t-small) var(--font); cursor: pointer; }
  .c-modes button.active { background: var(--surface); color: var(--fg); box-shadow: var(--elev-1); }
  .c-header-meta { justify-self: end; display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: var(--t-small); }
  .c-write-mode { position: relative; min-height: calc(100vh - 58px); display: grid; place-items: start center; padding: 34px 20px 120px; box-sizing: border-box; }
  .c-write-paper { width: min(650px, 100%); min-height: 720px; box-sizing: border-box; padding: 80px 88px; }
  .c-study-callout { position: fixed; right: 28px; bottom: 82px; padding: 12px 15px; border: 1px solid var(--accent); border-radius: var(--r-md); background: var(--surface); color: var(--fg); box-shadow: var(--elev-2); text-align: left; cursor: pointer; }
  .c-study-callout span { display: block; color: var(--accent-text); font-size: 10px; }.c-study-callout strong { display: block; margin-top: 3px; font-size: var(--t-small); }
  .c-study-mode { height: calc(100vh - 58px); display: grid; grid-template-columns: minmax(390px, .9fr) minmax(480px, 1.1fr); }
  .c-source-pane { display: grid; grid-template-rows: auto 1fr auto; min-width: 0; border-right: 1px solid var(--border); background: var(--canvas); }
  .c-source-pane > header, .c-source-pane > footer { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .c-source-pane > footer { border-top: 1px solid var(--border); border-bottom: 0; color: var(--muted); font-size: var(--t-caption); }
  .c-source-pane header span, .c-learning-head span { display: block; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .1em; }.c-source-pane header strong, .c-learning-head strong { display: block; margin-top: 3px; font-size: var(--t-ui); }
  .c-source-pane header button { border: 0; background: transparent; color: var(--accent-text); font: 600 var(--t-small) var(--font); cursor: pointer; }
  .c-source-copy { overflow: auto; padding: 48px clamp(38px, 7vw, 82px); background: #fff; color: #161616; }
  .c-source-copy h1, .c-source-copy p { font-family: "Times New Roman", Times, serif; }.c-source-copy h1 { margin: 0 0 34px; font-size: 17px; text-align: center; }.c-source-copy p { margin: 0 0 18px; font-size: 15px; line-height: 2; text-indent: 34px; }
  .c-learning-pane { min-width: 0; overflow: auto; padding: 28px clamp(28px, 5vw, 64px) 110px; background: var(--bg); }
  .c-learning-head { margin-bottom: 22px; }
  .c-lanes { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--border); }
  .c-lanes button { padding: 12px 8px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); text-align: left; font: inherit; cursor: pointer; }
  .c-lanes button.active { border-bottom-color: var(--accent); color: var(--fg); }.c-lanes span { display: block; font-size: var(--t-small); font-weight: 600; }.c-lanes small { font-size: 9px; }
  .c-session { max-width: 590px; padding-top: 34px; }
  .c-session-label { color: var(--accent-text); font-size: 9px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; }
  .c-session h2 { margin: 8px 0 14px; font-size: 25px; line-height: 1.2; letter-spacing: -.02em; }.c-session > p { color: var(--fg-2); font-size: var(--t-ui); line-height: 1.6; }
  blockquote { margin: 24px 0; padding: 16px 18px; border-left: 3px solid var(--warn); background: var(--warn-soft); color: var(--fg-2); font-family: var(--serif); font-size: 16px; line-height: 1.5; }
  textarea { width: 100%; min-height: 100px; box-sizing: border-box; padding: 12px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--surface); color: var(--fg); font: var(--t-ui) var(--font); resize: vertical; }
  .c-session-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .c-privacy-lines { display: grid; gap: 8px; margin: 22px 0; }.c-privacy-lines span { padding: 10px 0; border-bottom: 1px solid var(--border); color: var(--fg-2); font-size: var(--t-small); }
  .c-options { display: grid; gap: 8px; margin: 20px 0; }.c-explanation { margin-top: 18px; padding: 16px; border-left: 3px solid var(--success); background: var(--success-soft); }.c-explanation p { color: var(--fg-2); font-size: var(--t-small); line-height: 1.5; }
  @media (max-width: 900px) { .c-study-mode { grid-template-columns: 1fr; overflow: auto; } .c-source-pane { max-height: 46vh; border-right: 0; border-bottom: 1px solid var(--border); } .c-learning-pane { overflow: visible; } }
  @media (max-width: 620px) { .c-header { grid-template-columns: auto 1fr; } .c-header-meta { display: none; } .c-modes { justify-self: end; } .c-study-mode { height: auto; min-height: calc(100vh - 58px); } .c-source-pane { max-height: 42vh; } .c-source-pane footer { display: none; } .c-learning-pane { padding: 22px 18px 110px; } }
</style>
