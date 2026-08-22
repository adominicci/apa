<script lang="ts">
  import type { PrototypeActions, PrototypeState } from "./types";

  interface Props {
    state: PrototypeState;
    actions: PrototypeActions;
  }

  let { state, actions }: Props = $props();
  const aiLabel = $derived({
    "not-installed": "Set up local AI",
    consent: "Accept mock consent",
    ready: "Review selected text",
    reviewed: "Review complete",
  }[state.localAi.status]);
</script>

<section class="margin-guide" aria-label="Variant A, margin guide">
  <header class="prototype-titlebar">
    <div class="prototype-brand"><span class="prototype-mark">T</span> Tesina</div>
    <strong>La educación pública en Puerto Rico</strong>
    <span class="prototype-locale">UI EN · DOC ES</span>
  </header>

  <div class="a-shell">
    <aside class="a-outline">
      <span class="a-kicker">Document</span>
      <strong>Structure</strong>
      <a class="active" href="#intro">Introduction</a>
      <a href="#evidence">Evidence</a>
      <a href="#conclusion">Conclusion</a>
      <div class="a-progress"><span style="width: 38%"></span></div>
      <small>946 of 2,500 words</small>
    </aside>

    <main class="a-canvas">
      <article class="mock-paper a-paper" id="intro">
        <span class="a-page-number">1</span>
        <h1>La educación pública en Puerto Rico</h1>
        <p>
          La educación pública cumple una función esencial en el desarrollo de
          una <button class:corrected={state.spelling.status === "corrected"} class="mock-word" onclick={actions.applySuggestion}>{state.spelling.word}</button>
          académica capaz de responder a los cambios sociales.
        </p>
        <p>
          Sin embargo, <mark class="mock-highlight">es importante mejorar muchas
          cosas para lograr mejores resultados</mark>. Esta afirmación requiere
          una explicación más concreta y evidencia que permita evaluarla.
        </p>
        <p>
          Los datos de matrícula y retención ofrecen un punto de partida para
          describir el problema sin atribuirlo a una sola causa.
        </p>
      </article>
      <span class="a-thread spelling-thread"></span>
      <span class="a-thread coach-thread"></span>
    </main>

    <aside class="a-guide">
      <div class="a-guide-head">
        <div><span class="a-kicker">Learning guide</span><h2>Revise with purpose</h2></div>
        <span class="a-count">2</span>
      </div>

      <section class="a-note spelling-note">
        <div class="a-note-label"><span class="a-dot spelling"></span> Spelling</div>
        {#if state.spelling.status === "issue"}
          <strong>oracionn</strong>
          <p>The Spanish dictionary does not recognize this word.</p>
          <button class="mock-action primary" onclick={actions.applySuggestion}>Replace with “oración”</button>
        {:else}
          <strong>Corrected</strong>
          <p>The student-approved replacement is now in the mock passage.</p>
        {/if}
      </section>

      <section class="a-note coach-note">
        <div class="a-note-label"><span class="a-dot coach"></span> Writing coach</div>
        <strong>Be more specific</strong>
        <p>What should improve, and which result would show that it worked?</p>
        {#if state.coach.status === "unread"}
          <button class="mock-action" onclick={actions.openCoach}>Think through this</button>
        {:else if state.coach.status === "reflecting"}
          <textarea aria-label="Student reflection" placeholder="Write your own answer here"></textarea>
          <button class="mock-action primary" onclick={actions.markRevised}>I revised the passage</button>
        {:else}
          <span class="a-resolved">Revised by the student</span>
        {/if}
      </section>

      <section class="a-note ai-note">
        <div class="a-note-label"><span class="a-dot ai"></span> Local AI · optional</div>
        <strong>Review selected text</strong>
        <p>{state.localAi.status === "not-installed" ? "No model is installed. Spelling and coaching still work." : "The mock model runs only when you request it."}</p>
        <button class="mock-action" onclick={actions.advanceLocalAi} disabled={state.localAi.status === "reviewed"}>{aiLabel}</button>
      </section>

      <section class="a-note quiz-note">
        <div class="a-note-label"><span class="a-dot quiz"></span> Study quiz</div>
        {#if state.quiz.status === "idle"}
          <strong>Practice this section</strong>
          <p>Build a private quiz from the selected source passage.</p>
          <button class="mock-action" onclick={actions.startQuiz}>Start grounded quiz</button>
        {:else}
          <strong>What offers a starting point for describing the problem?</strong>
          <div class="a-options">
            {#each ["A single cause", "Enrollment and retention data", "A personal opinion", "The document title"] as option, index}
              <button class:selected={state.quiz.selectedOption === index} class="mock-option" onclick={() => actions.selectQuizOption(index)}>{option}</button>
            {/each}
          </div>
          {#if state.quiz.status === "question"}
            <button class="mock-action primary" disabled={state.quiz.selectedOption === null} onclick={actions.submitQuiz}>Submit answer</button>
          {:else}
            <p class="a-answer">Enrollment and retention data. The answer is supported by the final sentence.</p>
          {/if}
        {/if}
      </section>
    </aside>
  </div>
</section>

<style>
  .margin-guide { min-height: 100vh; background: var(--canvas); }
  .a-shell { height: calc(100vh - 40px); display: grid; grid-template-columns: 190px minmax(520px, 1fr) 340px; }
  .a-outline { padding: 30px 18px; border-right: 1px solid var(--border); background: var(--chrome); display: flex; flex-direction: column; gap: 8px; }
  .a-kicker { color: var(--muted); font-size: 9px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase; }
  .a-outline strong { margin-bottom: 12px; font-size: var(--t-h3); }
  .a-outline a { padding: 8px 10px; border-radius: var(--r-sm); color: var(--muted); text-decoration: none; font-size: var(--t-small); }
  .a-outline a.active { background: var(--accent-soft); color: var(--accent-text); font-weight: var(--w-strong); }
  .a-progress { height: 4px; margin-top: auto; overflow: hidden; border-radius: var(--r-pill); background: var(--border); }
  .a-progress span { display: block; height: 100%; background: var(--accent); }
  .a-outline small { color: var(--muted); font-size: 10px; }
  .a-canvas { position: relative; overflow: auto; padding: 46px 56px 130px; display: flex; justify-content: center; }
  .a-paper { position: relative; width: min(610px, 100%); min-height: 740px; box-sizing: border-box; padding: 74px 82px; }
  .a-page-number { position: absolute; top: 34px; right: 55px; font: 12px "Times New Roman", serif; }
  .a-thread { position: absolute; right: 0; width: 52px; border-top: 1px solid; }
  .a-thread::after { content: ""; position: absolute; right: -4px; top: -4px; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .spelling-thread { top: 227px; color: var(--danger); }
  .coach-thread { top: 360px; color: var(--warn); }
  .a-guide { overflow: auto; padding: 22px 20px 120px; border-left: 1px solid var(--border); background: var(--bg); }
  .a-guide-head { display: flex; align-items: start; justify-content: space-between; margin-bottom: 20px; }
  .a-guide-head h2 { margin: 4px 0 0; font-size: var(--t-h2); }
  .a-count { min-width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: var(--warn-soft); color: var(--warn-strong); font-size: var(--t-small); font-weight: 700; }
  .a-note { position: relative; margin-bottom: 10px; padding: 15px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); box-shadow: var(--elev-1); }
  .a-note strong { display: block; margin: 8px 0 4px; font-size: var(--t-ui); }
  .a-note p { margin: 0 0 10px; color: var(--muted); font-size: var(--t-small); line-height: 1.45; }
  .a-note-label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; }
  .a-dot { width: 7px; height: 7px; border-radius: 50%; }
  .a-dot.spelling { background: var(--danger); } .a-dot.coach { background: var(--warn); } .a-dot.ai { background: var(--accent); } .a-dot.quiz { background: var(--success); }
  textarea { width: 100%; min-height: 64px; box-sizing: border-box; margin: 8px 0; padding: 8px; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg); color: var(--fg); font: inherit; font-size: var(--t-small); resize: vertical; }
  .a-resolved, .a-answer { color: var(--success-text); font-size: var(--t-small); font-weight: var(--w-medium); }
  .a-options { display: grid; gap: 5px; margin: 10px 0; }
  @media (max-width: 1060px) { .a-shell { grid-template-columns: 0 minmax(480px, 1fr) 320px; } .a-outline { display: none; } }
  @media (max-width: 760px) { .a-shell { display: block; overflow: auto; } .a-canvas { padding: 24px 16px; } .a-paper { padding: 54px 40px; min-height: 600px; } .a-guide { border: 0; padding-bottom: 120px; } .a-thread { display: none; } }
</style>
