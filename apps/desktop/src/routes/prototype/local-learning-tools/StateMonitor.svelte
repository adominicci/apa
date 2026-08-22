<script lang="ts">
  import type { PrototypeState } from "./types";

  interface Props {
    state: PrototypeState;
    onReset: () => void;
  }

  let { state, onReset }: Props = $props();
  const snapshot = $derived(JSON.stringify(state, null, 2));
</script>

<details class="state-monitor">
  <summary>Mock state</summary>
  <pre>{snapshot}</pre>
  <button type="button" onclick={onReset}>Reset state</button>
</details>
