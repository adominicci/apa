<script lang="ts">
  import type { PrototypeActions, PrototypeState } from "./types";

  interface Props {
    state: PrototypeState;
    actions: PrototypeActions;
  }

  let { state: prototypeState, actions }: Props = $props();
  let activeTool = $state<"spelling" | "coach" | "ai" | "quiz">("spelling");

  function chooseTool(tool: typeof activeTool): void {
    activeTool = tool;
    prototypeState.lastAction = `Opened ${tool} in the learning ribbon`;
  }
</script>

<section class="learning-ribbon" aria-label="Variant B, learning ribbon">
  <header class="prototype-titlebar">
    <div class="prototype-brand"><span class="prototype-mark">T</span> Tesina</div>
    <strong>La educación pública en Puerto Rico</strong>
    <span class="prototype-locale">UI EN · DOC ES</span>
  </header>

  <main class="b-stage">
    <nav class="b-rail" aria-label="Document tools">
      <button class="active" aria-label="Document">D</button>
      <button aria-label="References">R</button>
      <span></span>
      <button aria-label="Export">E</button>
    </nav>

    <div class="b-canvas">
      <article class="mock-paper b-paper">
        <span class="b-page-number">1</span>
        <h1>La educación pública en Puerto Rico</h1>
        <p>
          La educación pública cumple una función esencial en el desarrollo de
          una <button class:corrected={prototypeState.spelling.status === "corrected"} class="mock-word" onclick={() => chooseTool("spelling")}>{prototypeState.spelling.word}</button>
          académica capaz de responder a los cambios sociales.
        </p>
        <p>
          Sin embargo, <button class="mock-highlight mock-highlight-button" onclick={() => chooseTool("coach")}>es importante mejorar muchas cosas para lograr mejores resultados</button>.
          Esta afirmación requiere una explicación más concreta y evidencia que
          permita evaluarla.
        </p>
        <p>
          Los datos de matrícula y retención ofrecen un punto de partida para
          describir el problema sin atribuirlo a una sola causa.
        </p>

        {#if activeTool === "spelling" && prototypeState.spelling.status === "issue"}
          <div class="b-context spelling-popover">
            <span>Spelling · Spanish</span>
            <strong>oracionn</strong>
            <button class="mock-action primary" onclick={actions.applySuggestion}>Replace with “oración”</button>
          </div>
        {:else if activeTool === "coach"}
          <div class="b-context coach-popover">
            <span>Deterministic coach · Specificity</span>
            <strong>What should improve, and how would you measure it?</strong>
            <button class="mock-action" onclick={prototypeState.coach.status === "reflecting" ? actions.markRevised : actions.openCoach}>
              {prototypeState.coach.status === "reflecting" ? "I revised it" : "Work on this"}
            </button>
          </div>
        {/if}
      </article>
    </div>
  </main>

  <aside class="b-ribbon" aria-label="Learning activity shelf">
    <div class="b-ribbon-tabs">
      <button class:active={activeTool === "spelling"} onclick={() => chooseTool("spelling")}>
        <span class="b-tool-mark spelling">S</span><span><small>Spelling</small><strong>{prototypeState.spelling.status === "issue" ? "1 issue" : "Clear"}</strong></span>
      </button>
      <button class:active={activeTool === "coach"} onclick={() => chooseTool("coach")}>
        <span class="b-tool-mark coach">W</span><span><small>Writing coach</small><strong>1 question</strong></span>
      </button>
      <button class:active={activeTool === "ai"} onclick={() => chooseTool("ai")}>
        <span class="b-tool-mark ai">AI</span><span><small>Local AI</small><strong>{prototypeState.localAi.status === "not-installed" ? "Optional" : prototypeState.localAi.status}</strong></span>
      </button>
      <button class:active={activeTool === "quiz"} onclick={() => chooseTool("quiz")}>
        <span class="b-tool-mark quiz">Q</span><span><small>Study quiz</small><strong>{prototypeState.quiz.status === "idle" ? "Ready" : prototypeState.quiz.status}</strong></span>
      </button>
    </div>

    <div class="b-active-tool">
      {#if activeTool === "spelling"}
        <div><small>Current word</small><strong>{prototypeState.spelling.word}</strong><p>Uses the Spanish document dictionary, not the English interface locale.</p></div>
        <button class="mock-action primary" onclick={actions.applySuggestion} disabled={prototypeState.spelling.status === "corrected"}>Apply “oración”</button>
      {:else if activeTool === "coach"}
        <div><small>Learning question</small><strong>What specific change would improve the result?</strong><p>Tesina points to the passage. The student writes the revision.</p></div>
        <button class="mock-action primary" onclick={prototypeState.coach.status === "reflecting" ? actions.markRevised : actions.openCoach}>{prototypeState.coach.status === "reflecting" ? "I revised it" : "Reflect first"}</button>
      {:else if activeTool === "ai"}
        <div><small>Selected text only</small><strong>{prototypeState.localAi.status === "not-installed" ? "Local model not installed" : "Local AI is ready"}</strong><p>The deterministic tools remain available without the model.</p></div>
        <button class="mock-action primary" onclick={actions.advanceLocalAi} disabled={prototypeState.localAi.status === "reviewed"}>{prototypeState.localAi.status === "not-installed" ? "See setup and privacy" : prototypeState.localAi.status === "consent" ? "Install mock model" : "Review selection"}</button>
      {:else}
        {#if prototypeState.quiz.status === "idle"}
          <div><small>Selected source · 83 words</small><strong>Practice what this passage says</strong><p>One answer, four options, and source-backed explanations.</p></div>
          <button class="mock-action primary" onclick={actions.startQuiz}>Start quiz</button>
        {:else}
          <div class="b-quiz-question">
            <small>Question 1 of 5</small>
            <strong>What offers a starting point for describing the problem?</strong>
            <div class="b-inline-options">
              {#each ["One cause", "Enrollment and retention data", "Opinion", "The title"] as option, index}
                <button class:selected={prototypeState.quiz.selectedOption === index} class="mock-option" onclick={() => actions.selectQuizOption(index)}>{option}</button>
              {/each}
            </div>
          </div>
          {#if prototypeState.quiz.status === "question"}
            <button class="mock-action primary" disabled={prototypeState.quiz.selectedOption === null} onclick={actions.submitQuiz}>Submit answer</button>
          {:else}
            <div class="b-source-proof"><small>Supported answer</small><strong>Enrollment and retention data</strong><p>View the final sentence in the selected source.</p></div>
          {/if}
        {/if}
      {/if}
    </div>
  </aside>
</section>

<style>
  .learning-ribbon { height: 100vh; background: var(--canvas); overflow: hidden; }
  .b-stage { height: calc(100vh - 228px); display: grid; grid-template-columns: 54px 1fr; }
  .b-rail { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 16px 0; border-right: 1px solid var(--border); background: var(--chrome); }
  .b-rail span { flex: 1; }
  .b-rail button { width: 32px; height: 32px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--muted); font: 600 10px var(--font); cursor: pointer; }
  .b-rail button.active { background: var(--accent); color: var(--accent-on); }
  .b-canvas { overflow: auto; padding: 34px 48px 90px; display: flex; justify-content: center; }
  .b-paper { position: relative; width: min(650px, 100%); min-height: 680px; box-sizing: border-box; padding: 68px 86px; }
  .b-page-number { position: absolute; top: 30px; right: 52px; font: 12px "Times New Roman", serif; }
  .mock-highlight-button { display: inline; padding: 0; border: 0; font: inherit; cursor: pointer; }
  .b-context { position: absolute; z-index: 2; width: 220px; padding: 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--elevated); color: var(--fg); box-shadow: var(--elev-3); font-family: var(--font); }
  .b-context::before { content: ""; position: absolute; left: 22px; bottom: -6px; width: 10px; height: 10px; transform: rotate(45deg); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--elevated); }
  .b-context span { display: block; color: var(--muted); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
  .b-context strong { display: block; margin: 6px 0 10px; font-size: var(--t-small); line-height: 1.4; }
  .spelling-popover { top: 165px; left: 245px; } .coach-popover { top: 280px; left: 255px; width: 250px; }
  .b-ribbon { position: relative; height: 188px; box-sizing: border-box; padding: 12px 22px 70px; border-top: 1px solid var(--border); background: var(--chrome); box-shadow: 0 -10px 30px color-mix(in oklab, var(--fg), transparent 94%); }
  .b-ribbon-tabs { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 8px; max-width: 920px; margin: -34px auto 10px; }
  .b-ribbon-tabs > button { min-height: 56px; display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); color: var(--fg-2); box-shadow: var(--elev-1); text-align: left; font: inherit; cursor: pointer; }
  .b-ribbon-tabs > button.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .b-ribbon-tabs small, .b-active-tool small { display: block; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .07em; }
  .b-ribbon-tabs strong { display: block; margin-top: 2px; font-size: var(--t-small); }
  .b-tool-mark { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; font-size: 9px; font-weight: 700; }
  .b-tool-mark.spelling { background: var(--danger-soft); color: var(--danger-text); } .b-tool-mark.coach { background: var(--warn-soft); color: var(--warn-strong); } .b-tool-mark.ai { background: var(--accent-soft); color: var(--accent-text); } .b-tool-mark.quiz { background: var(--success-soft); color: var(--success-text); }
  .b-active-tool { max-width: 920px; margin: 0 auto; display: flex; align-items: center; gap: 20px; justify-content: space-between; }
  .b-active-tool > div:first-child { min-width: 0; flex: 1; }
  .b-active-tool strong { display: block; margin: 2px 0; font-size: var(--t-ui); }
  .b-active-tool p { margin: 0; color: var(--muted); font-size: var(--t-small); }
  .b-quiz-question { display: grid; grid-template-columns: 160px 1fr; gap: 3px 14px; align-items: center; }
  .b-quiz-question small { grid-column: 1; }.b-quiz-question strong { grid-column: 1; }
  .b-inline-options { grid-column: 2; grid-row: 1 / 3; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .b-source-proof { max-width: 270px; padding-left: 16px; border-left: 2px solid var(--success); }
  @media (max-width: 840px) { .b-stage { grid-template-columns: 0 1fr; } .b-rail { display: none; } .b-ribbon-tabs { grid-template-columns: repeat(4, 1fr); } .b-ribbon-tabs > button { justify-content: center; } .b-ribbon-tabs > button span:last-child { display: none; } .b-active-tool { padding: 0 6px; } }
  @media (max-width: 620px) { .b-canvas { padding: 20px 12px 70px; } .b-paper { min-height: 570px; padding: 48px 34px; } .b-context { left: 28px; max-width: 70%; } .b-ribbon { height: 230px; } .b-stage { height: calc(100vh - 270px); } .b-active-tool { align-items: end; } .b-active-tool p { display: none; } .b-quiz-question { display: block; } .b-inline-options { display: none; } }
</style>
