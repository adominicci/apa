<script lang="ts">
  import { onMount } from "svelte";
  import { replaceState } from "$app/navigation";
  import PrototypeSwitcher from "./PrototypeSwitcher.svelte";
  import StateMonitor from "./StateMonitor.svelte";
  import VariantA from "./VariantA.svelte";
  import VariantB from "./VariantB.svelte";
  import VariantC from "./VariantC.svelte";
  import {
    createInitialState,
    type PrototypeActions,
    type VariantKey,
  } from "./types";
  import "./prototype.css";

  // Three end-state variants, switchable via ?variant=, on a throwaway route.
  const prototypeEnabled = import.meta.env.DEV;
  let variant = $state<VariantKey>("A");
  let prototypeState = $state(createInitialState());

  function readVariant(): VariantKey {
    const value = new URL(window.location.href).searchParams.get("variant");
    return value === "B" || value === "C" ? value : "A";
  }

  function setVariant(next: VariantKey): void {
    variant = next;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    replaceState(url, {});
    prototypeState.lastAction = `Switched to variant ${next}`;
  }

  function reset(): void {
    prototypeState = createInitialState();
  }

  const actions: PrototypeActions = {
    applySuggestion: () => {
      prototypeState.spelling = { word: "oración", status: "corrected" };
      prototypeState.lastAction = "Applied spelling suggestion: oración";
    },
    openCoach: () => {
      prototypeState.coach.status = "reflecting";
      prototypeState.lastAction = "Opened the deterministic coaching question";
    },
    markRevised: () => {
      prototypeState.coach.status = "revised";
      prototypeState.lastAction = "Marked the passage revised by the student";
    },
    advanceLocalAi: () => {
      const next = {
        "not-installed": "consent",
        consent: "ready",
        ready: "reviewed",
        reviewed: "reviewed",
      } as const;
      prototypeState.localAi.status = next[prototypeState.localAi.status];
      prototypeState.lastAction = {
        consent: "Opened local model consent",
        ready: "Installed the mock local model",
        reviewed: "Ran a mock selected-text review",
        "not-installed": "Local AI is not installed",
      }[prototypeState.localAi.status];
    },
    startQuiz: () => {
      prototypeState.quiz = { status: "question", selectedOption: null };
      prototypeState.lastAction = "Started a grounded quiz from the selected passage";
    },
    selectQuizOption: (index) => {
      if (prototypeState.quiz.status !== "question") return;
      prototypeState.quiz.selectedOption = index;
      prototypeState.lastAction = `Selected quiz option ${index + 1}`;
    },
    submitQuiz: () => {
      if (
        prototypeState.quiz.status !== "question" ||
        prototypeState.quiz.selectedOption === null
      ) return;
      prototypeState.quiz.status = "answered";
      prototypeState.lastAction = "Submitted the quiz answer once";
    },
    reset,
  };

  onMount(() => {
    variant = readVariant();
    const handlePopState = () => (variant = readVariant());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  });
</script>

<svelte:head>
  <title>Tesina learning tools prototype</title>
</svelte:head>

{#if prototypeEnabled}
  <div class="prototype-route ui-controls" data-variant={variant}>
    {#if variant === "A"}
      <VariantA state={prototypeState} {actions} />
    {:else if variant === "B"}
      <VariantB state={prototypeState} {actions} />
    {:else}
      <VariantC state={prototypeState} {actions} />
    {/if}
    <StateMonitor state={prototypeState} onReset={reset} />
    <PrototypeSwitcher current={variant} onChange={setVariant} />
  </div>
{:else}
  <main class="prototype-disabled">
    <h1>Prototype unavailable</h1>
    <p>This throwaway route runs only in development.</p>
  </main>
{/if}
