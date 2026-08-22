# Local AI module for Tesina

Research date: 2026-08-22

Delivery authority: [`docs/plans/local-learning-tools-delivery.md`](../plans/local-learning-tools-delivery.md).
This note records research evidence; the canonical plan owns sequence, task
boundaries, release gates, and PR strategy.

## Conclusion

Yes. A thin, local AI module is feasible, and it fits Tesina if it is designed
as a **learning-oriented writing coach**, not an AI-authorship detector or a
general-purpose agent.

The recommended end state is an **optional, Tesina-managed `llama-server`
sidecar**, with model weights downloaded only after explicit user consent. The
module should own a narrow typed API, process lifecycle, model installation,
and privacy policy. `llama.cpp` should own inference. For an initial experiment,
supporting an already-installed Ollama service is faster, but it should not be
the only long-term path because it adds a separate application, lifecycle, and
compatibility requirement.

The first capability should identify concrete symptoms of weak or generic prose
in English and Spanish: vague claims, empty transitions, unsupported assertions,
repetition, inflated wording, and paragraphs that say little. It should explain
the issue and ask the student to supply meaning or evidence before offering a
rewrite. A later quiz skill can turn selected course material into questions
whose answers are grounded in that material. Tesina's deterministic engine
should remain authoritative for APA formatting, numbering, citations,
references, document schema, and export.

## Refined product recommendation: a coach, not a detector

"AI slop" is useful product language for recognizable writing problems, but it
is not a reliable authorship label. OpenAI withdrew its own AI-text classifier
because of low accuracy, and peer-reviewed research found that GPT detectors can
systematically misclassify non-native English writers. That is especially
important for a bilingual academic product. Tesina should therefore never emit
"AI-generated," an AI probability, or evidence for misconduct. It should report
observable problems in the text regardless of who or what wrote it.
([OpenAI classifier notice](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/),
[Liang et al., *Patterns*](https://doi.org/10.1016/j.patter.2023.100779))

The recommended interaction is **diagnose -> question -> revise -> reflect**:

1. Highlight the exact span and name the issue in the document language.
2. Explain why it weakens this passage, without speculating about authorship.
3. Ask a learning question such as "What specific evidence supports this?" or
   "What do you mean by *important* here?"
4. Let the student revise first; make an example rewrite an optional secondary
   action, always behind accept/reject and undo.
5. After revision, show which issues were resolved and ask the student to state
   what changed.

This is also the right foundation for quizzes. A later `quizFromMaterial` skill
should accept selected passages, require every answer and explanation to cite a
source span, support English and Spanish independently of the UI locale, and
present one question at a time before revealing the answer. The model may draft
questions; the source text remains authoritative.

### Use a task-oriented skill, not an agent

Tesina does not need planning, tools, file access, or an agent loop for either
feature. A versioned task definition is the smaller and safer abstraction:

```text
writingCoachV1
  input: documentLanguage + selected text + optional nearby context
  rubric: specificity, evidence, clarity, economy, repetition, voice
  output: [{ span, category, explanation, learningQuestion, confidence }]

quizFromMaterialV1
  input: documentLanguage + selected source passages + difficulty
  output: [{ question, answer, explanation, sourceSpans }]
```

Call this a "skill" in the code if useful, but keep it as a prompt/rubric,
bilingual examples, a JSON schema, and evaluation fixtures. It is not an
autonomous runtime. `llama-server` can constrain generation with JSON Schema, which makes
the boundary practical even with small models.
([llama-server structured output](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-completion-given-a-prompt-it-returns-the-predicted-completion))

### Two layers are better than asking a tiny model to do everything

Run inexpensive, deterministic checks first, then give only the relevant text
and signals to the model:

- **Deterministic layer:** repeated phrases, repeated sentence openings,
  sentence/paragraph length, filler and intensifier lexicons, empty transition
  patterns, citation-shaped claims without a nearby citation, and language-aware
  spelling/grammar signals. These findings are fast, explainable, and stable.
- **Small-model layer:** decide whether a flagged phrase is actually vague in
  context, identify claims that may need support, explain why a passage feels
  generic, and generate a question that makes the student provide the missing
  substance. "Unsupported" must remain "check or support this claim," because a
  local model cannot verify the world from the paragraph alone.

Existing prose tools confirm that this split is viable, but none is a perfect
drop-in for Tesina:

| Project | GitHub stars | Bilingual fit | Packaging and UX | Tesina verdict |
| --- | ---: | --- | --- | --- |
| [Humanizer](https://api.github.com/repos/blader/humanizer) | 37,115 | Published examples and vocabulary are English-centric. | Excellent skill UX: one Markdown file, visible critique, and an MIT license; its default outcome is a rewrite. | Best reference for packaging a slop rubric as a skill, but automatic "humanization" conflicts with the learning goal. Adapt the rubric, not the rewrite behavior. |
| [LanguageTool](https://api.github.com/repos/languagetool-org/languagetool) | 14,849 | Strong English and Spanish grammar/spelling | Local server is Java-based; its own documentation calls self-hosting an advanced-user path, and local mode excludes its AI rules. | Capable grammar reference, but too heavy and its LGPL-2.1 license is outside Tesina's current dependency policy. |
| [Harper](https://api.github.com/repos/Automattic/harper) | 14,667 | English only today. | Fast, private Rust/WASM grammar checker with an Apache-2.0 license. | Good local-product UX reference, but it cannot meet the Spanish requirement without new language work. |
| [Vale](https://api.github.com/repos/vale-cli/vale) | 5,990 | Custom bilingual pattern rules are possible; most ready-made styles are English-centric. | Polished cross-platform single binary, offline, YAML rules, structured diagnostics. | Best existing deterministic engine to prototype, but direct TypeScript rules may be thinner for ProseMirror text. |
| [write-good](https://api.github.com/repos/btford/write-good) | 5,083 | English only by design. | Tiny JavaScript API and simple checks. | Useful rule inspiration; not the bilingual foundation. |
| [textlint](https://api.github.com/repos/textlint/textlint) | 3,170 | Depends on installed rules; custom rules can be bilingual. | Good AST/plugin API, but requires Node.js 20+ and separately packaged rule modules. | Flexible, but more machinery than Tesina needs. |

Stars are a point-in-time GitHub API snapshot from **2026-08-22 08:25 UTC**;
they measure adoption, not suitability. Vale describes itself as an offline,
cross-platform style-rule framework rather than a general grammar assistant.
LanguageTool officially supports English and Spanish, but its local server
requires Java, omits cloud-only AI rules, and is LGPL-2.1. Humanizer shows the
right skill-sized packaging and observable-pattern rubric, but optimizes for
rewriting text to appear human. Harper and `write-good` are explicitly
English-only; textlint is a Node-based plugin framework.
([Humanizer README](https://github.com/blader/humanizer),
[Harper README](https://github.com/Automattic/harper),
[Vale scope and installation](https://docs.vale.sh/),
[LanguageTool languages](https://github.com/languagetool-org/languagetool/blob/master/README.md),
[LanguageTool local server](https://github.com/languagetool-org/languagetool-org.github.io/blob/master/http-server.md),
[write-good README](https://github.com/btford/write-good),
[textlint setup](https://textlint.org/docs/getting-started/))

The smallest product implementation is consequently an internal TypeScript
rule set over editor text, with separate `en` and `es` lexicons and shared
language-neutral structural checks. Humanizer's skill shape and Vale's rule
design are useful references. LanguageTool should not be bundled under Tesina's
current license policy; full grammar checking can be evaluated separately if it
becomes a product requirement.

## GitHub runtime ranking: adoption plus student UX

The following ranking separates GitHub popularity from the UX Tesina could
deliver. "UX fit" is a qualitative score for an ordinary student who should not
have to understand models, ports, or terminals.

| Rank | Runtime | GitHub stars | UX fit | Why |
| ---: | --- | ---: | :---: | --- |
| 1 | [`llama.cpp` / `llama-server`](https://api.github.com/repos/ggml-org/llama.cpp) | 125,083 | 5/5 managed, 2/5 manual | Best Tesina-owned sidecar: native releases, GGUF, CPU/Metal/other backends, streaming HTTP, cancellation-friendly process isolation, and schema-constrained JSON. Tesina can hide all runtime details. |
| 2 | [Ollama](https://api.github.com/repos/ollama/ollama) | 179,149 | 4/5 | Easiest prototype and model-management experience, but students must install a separate background application and current macOS support starts above Tesina's minimum. |
| 3 | [llamafile](https://api.github.com/repos/mozilla-ai/llamafile) | 25,670 | 4/5 | Attractive no-install, single-executable distribution across common OS/CPU targets; Windows has a documented 4 GB executable ceiling, and Tesina would still own model/update UX. |
| 4 | [WebLLM](https://api.github.com/repos/mlc-ai/web-llm) | 18,585 | 3/5 | Excellent npm API, worker support, cache, streaming, and structured JSON with no sidecar; WebGPU and system-webview variance make support less predictable. |
| 5 | [Transformers.js](https://api.github.com/repos/huggingface/transformers.js) | 16,264 | 3/5 | Familiar JavaScript pipeline over ONNX Runtime with WASM CPU and optional WebGPU, but Tesina would own more model conversion, performance, and generation behavior. |
| 6 | [Candle](https://api.github.com/repos/huggingface/candle) | 20,940 | 2/5 | Strong Rust building block with CPU, CUDA, Metal, and WASM examples, but not a turnkey end-user model service. |
| 7 | [`mistral.rs`](https://api.github.com/repos/EricLBuehler/mistral.rs) | 7,620 | 3/5 | Capable Rust server/SDK with prebuilt installers and quantized-model support, but much broader than this feature and less proven than `llama.cpp`. |

Stars were captured from the official GitHub API at **2026-08-22 08:25 UTC**.
The ranking favors Tesina fit rather than sorting by stars. Official repository
documentation supports the UX distinctions above.
([llama.cpp](https://github.com/ggml-org/llama.cpp),
[Ollama](https://github.com/ollama/ollama),
[llamafile](https://github.com/mozilla-ai/llamafile),
[WebLLM](https://github.com/mlc-ai/web-llm),
[Transformers.js](https://github.com/huggingface/transformers.js),
[Candle](https://github.com/huggingface/candle),
[`mistral.rs`](https://github.com/EricLBuehler/mistral.rs))

## Very small bilingual model shortlist

Model choice needs a Tesina-specific evaluation; parameter count and model-card
benchmarks do not establish writing-coach quality. The practical shortlist is:

| Rank | Model | License and language evidence | Download/quality tradeoff | Recommendation |
| ---: | --- | --- | --- | --- |
| 1 | [Qwen3.5 2B](https://huggingface.co/Qwen/Qwen3.5-2B) | Apache-2.0; official card claims 201 languages/dialects and publishes multilingual benchmarks. | [Current 4-bit GGUF artifacts](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF) are roughly 1.3–1.4 GB; official results show a large instruction-following and multilingual gain over the 0.8B sibling. | **Primary evaluation candidate** for slop coaching and later grounded quizzes. Run text-only, non-thinking mode with a deliberately small context. |
| 2 | [SmolLM3 3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B) | Apache-2.0; English and Spanish are among six natively supported languages, with Spanish results in the official card. | About 2 GB at 4-bit; older, straightforward decoder architecture and unusually transparent training resources. | Best comparison model when judging bilingual quality and a strong fallback if Qwen3.5 runtime support is uneven. |
| 3 | [Qwen3.5 0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) | Apache-2.0; same 201-language claim. | Official [`llama.cpp` conversion](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF) is 563 MB at Q4_0, but the official card positions this size for prototyping/task-specific work and its instruction scores trail 2B materially. | **Low-resource experiment**, not the default until it passes the bilingual rubric. Excellent for testing the lower bound. |
| 4 | [Qwen3 4B](https://huggingface.co/Qwen/Qwen3-4B) | Apache-2.0; official card claims 100+ languages/dialects. | Official Q4_K_M GGUF is 2.5 GB; more headroom for nuanced feedback and quizzes, but no longer "very small." | Quality fallback for capable hardware, not the first download. |
| 5 | [Phi-4 Mini Instruct](https://huggingface.co/microsoft/Phi-4-mini-instruct) | MIT; official card lists English and Spanish among 24 supported languages. | 3.8B parameters; likely similar disk/RAM class to Qwen 4B. Microsoft warns that factual knowledge is limited by size. | Worth benchmarking for reasoning, but not smaller than the Qwen 4B class. |
| 6 | [Gemma 3 1B IT](https://huggingface.co/google/gemma-3-1b-it) | Gemma license rather than an OSI license; family card claims 140+ languages. | Small, but gated download/terms add consent and redistribution friction. | Technically viable; operationally worse for Tesina than Apache/MIT models. |
| 7 | [Llama 3.2 1B Instruct](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct) | Llama 3.2 Community License; official card includes English and Spanish among eight supported languages. | Small, but gated access plus attribution and license obligations add product friction. | No clear reason to prefer it over Qwen3.5 0.8B/2B here. |
| 8 | [SmolLM2 1.7B Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct) | Apache-2.0, but the official card labels it English. | Compact and explicitly trained for rewriting/summarization. | Exclude from a bilingual default; SmolLM3 supersedes it for this use case. |

Quantized file size is not peak memory. Context/KV cache, runtime buffers, and
backend behavior add memory, so Tesina should cap the initial context (for
example, selected paragraph plus limited neighbors) and measure peak resident
memory on minimum hardware. Qwen3.5's official card itself warns that its
262,144-token default context can cause out-of-memory errors and recommends
reducing it; Tesina does not need anything close to that context for the first
skill. The product should offer one recommended model download, show its exact
disk size before consent, preflight available memory/disk, and keep a lower-RAM
alternative behind an advanced choice.

## Three architectures

| Shape | What it means | Strengths | Costs | Verdict |
| --- | --- | --- | --- | --- |
| Embedded engine | Link an inference library into the Tauri/Rust process and call it in-process. | No localhost service; tightest process integration. | Native FFI/build matrix becomes part of Tesina; an engine crash can take down the editor; GPU/backend and library updates are coupled to the app. | Possible, but not the thinnest operationally. Avoid for the first version. |
| Managed localhost sidecar | Bundle a pinned `llama-server` binary, start it on demand, and call its loopback HTTP API. | Self-contained UX, process isolation, streaming API, and a very small Tesina adapter. | Per-target binaries, signing/notarization, lifecycle supervision, loopback hardening, and model download/update UX. | **Recommended end state.** |
| External local runtime | Detect an independently installed Ollama (or user-configured compatible endpoint). | Smallest prototype and no engine distribution burden. | User setup; another app owns updates and models; availability and API behavior are outside Tesina's control. | **Recommended prototype**, optional advanced provider later. |

Tauri explicitly supports external binaries ("sidecars") and requires a binary
named for each Rust target triple. That maps naturally to Tesina's macOS
universal build and Windows x64 build, but it also means the release workflow
must prepare, sign, and test every sidecar architecture. Tauri can also bundle
additional resources, although multi-gigabyte model files are better stored in
the per-user app-data directory than in the application bundle.
([Tauri sidecars](https://v2.tauri.app/develop/sidecar/),
[Tauri resources](https://v2.tauri.app/develop/resources/))

## Fact-check of the proposed Tauri approach (2026-08-22)

The quoted advice is directionally right about Tauri and local inference, but
several claims are too broad for a production design. The parts worth keeping
are the use of a native inference engine, optional model weights, and a managed
sidecar as the default architecture. The following corrections should become
planning constraints.

### Architecture and security corrections

- **A sidecar is supported, not automatically safe.** Tauri 2 packages external
  binaries per Rust target triple and can spawn them from Rust or JavaScript.
  JavaScript spawning requires an explicit `shell:allow-spawn` capability;
  dynamic arguments must also be scoped. For Tesina, Rust should own the child
  process and expose narrow typed commands to Svelte. This follows Tauri's own
  process-model advice to keep sensitive state and business logic in the core
  and reduces the authority granted to a compromised webview.
- **Loopback is not an isolation boundary.** `llama-server` defaults to
  `127.0.0.1`, supports `--api-key`, and can disable its web UI, but other local
  processes can still reach a loopback port. Tesina should choose an ephemeral
  port, create a random per-process token, pass requests through Rust, set a
  restrictive CSP without general localhost access, and start the server with
  `--no-webui`. The server health endpoint remains public even when API-key
  authentication is enabled, so it must reveal no document information.
- **Do not start inference on application launch.** Starting the executable is
  cheap compared with loading weights and allocating runtime/context memory.
  Tesina should start it only after the student invokes a model-backed action,
  then stop only the verified child process it owns. Spelling and deterministic
  coaching remain available without it.
- **Tauri's system webview reduces packaged runtime size, not model cost.** Tauri
  does not bundle Chromium, which generally leaves a smaller application
  footprint, but it still uses separate core and webview processes. Peak AI
  memory includes quantized weights, KV cache, runtime buffers, and accelerator
  allocations. It must be measured rather than inferred from Tauri's installer
  size.

([Tauri sidecars and capability scopes](https://v2.tauri.app/develop/sidecar/),
[Tauri process model](https://v2.tauri.app/concept/process-model/),
[Tauri capabilities](https://v2.tauri.app/security/capabilities/),
[Tauri CSP](https://v2.tauri.app/security/csp/),
[`llama-server` controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md))

### `llama.cpp` versus Candle

The claim that in-process Candle necessarily has the lowest latency is not
established. It removes HTTP/process serialization, but end-to-end latency is
dominated by model loading, prompt evaluation, token generation, quantization,
and the selected CPU/GPU backend. Candle is a capable Apache-2.0/MIT Rust ML
framework with CPU, CUDA, Metal, and WASM support; it is a building block, not a
turnkey model service. An embedded Candle path would make Tesina responsible for
model implementation compatibility, backend feature builds, crash containment,
and a larger native test matrix.

`llama.cpp` already supplies quantized GGUF inference, broad native backends,
prebuilt releases, schema-constrained output, health checks, and a small HTTP
server. Process isolation is more valuable here than eliminating a tiny local
HTTP hop. The managed sidecar therefore remains the thinner production
boundary. Candle is worth reconsidering only if measurements later show a
specific capability or distribution advantage.

([Candle project and supported backends](https://github.com/huggingface/candle),
[`llama.cpp` project](https://github.com/ggml-org/llama.cpp),
[`llama-server` API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md))

### Installer and CI consequences

Bundling a prebuilt sidecar increases each platform installer, and Tauri
requires the matching external binary for every target triple. Tesina's macOS
universal and Windows x64 release paths must therefore acquire, pin, sign, and
smoke-test the corresponding binaries. Model weights should remain an optional
post-install download; embedding a roughly 1.4 GB model would make application
downloads and ordinary updates unnecessarily large.

Normal PR CI should not compile `llama.cpp`, download weights, or run real
inference. It should test the typed provider contract with a fake process. A
separate path-filtered/manual or release job can verify each pinned sidecar and
model combination. This keeps the sidecar from materially extending the
already-slow macOS and Windows jobs while still giving the release boundary
platform-specific evidence.

### Model-list corrections

The quoted three-model list is dated and does not fit Tesina's bilingual
requirement:

| Quoted model | Verified limitation | Tesina assessment |
| --- | --- | --- |
| [Phi-3 Mini 4K Instruct](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct) | 3.8B parameters; Microsoft's card states that its intended use is English. Microsoft's official recommended Q4 GGUF is 2.2 GB. | Lean relative to large models, but neither the smallest nor an evidence-backed English/Spanish choice. The newer [Phi-4 Mini](https://huggingface.co/microsoft/Phi-4-mini-instruct) explicitly supports Spanish, but remains 3.8B. |
| [Llama 3 8B Instruct](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct) | 8B parameters, gated custom license, superseded by Llama 3.1; Meta's card declares non-English use out of scope without fine-tuning. | Not lean for this feature and not an appropriate Spanish launch model. |
| [Gemma 2 2B IT](https://huggingface.co/google/gemma-2-2b-it) | The official card describes English input/output and uses the Gemma license with gated terms. | Size is plausible, but language and redistribution friction make it inferior here. [Gemma 3 1B](https://huggingface.co/google/gemma-3-1b-it) is multilingual, but retains Gemma licensing and still needs Tesina-specific quality testing. |

Qwen3.5 2B remains the intended **benchmark candidate**, not a final selection.
Its official card is Apache-2.0, claims support for 201 languages/dialects, and
shows substantially stronger multilingual and instruction results than its
0.8B sibling. It also calls the 2B model appropriate for prototyping and
task-specific work. That is promising evidence, not proof that it can provide
accurate bilingual coaching or uniquely grounded multiple-choice questions.
The release decision still requires the agreed blind English/Spanish fixture
gates on Tesina's minimum hardware and the exact pinned `llama.cpp` build.
([Qwen3.5 2B official model card](https://huggingface.co/Qwen/Qwen3.5-2B))

## Why `llama.cpp` / `llama-server` is the best fit

`llama.cpp` is an MIT-licensed C/C++ runtime with CPU inference and accelerator
backends including Metal, CUDA, HIP, Vulkan, and others. It runs quantized GGUF
models and publishes native binaries for macOS and Windows. Its server exposes
streaming, OpenAI-compatible chat endpoints, defaults to `127.0.0.1`, supports
API-key authentication, and has a health endpoint. These properties let Tesina
keep one small HTTP/process adapter rather than bind a changing native C API
directly into its main process.
([project and backends](https://github.com/ggml-org/llama.cpp),
[server API and controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
[MIT license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE),
[native release artifacts](https://github.com/ggml-org/llama.cpp/releases))

The sidecar should be built and pinned by Tesina, not downloaded as an arbitrary
"latest" executable at runtime. `llama.cpp` changes frequently, so app releases
should carry a tested engine build and its notices. Model compatibility should
be tested against that exact build.

### Model size and license are separate concerns

The runtime's MIT license does not license the weights. Every offered model must
have its own reviewed license and attribution. The refined shortlist above puts
Qwen3.5 2B first, with SmolLM3 3B as the bilingual comparison and Qwen3.5 0.8B
as the low-resource experiment. No model should be selected from its card alone:
quality, latency, structured-output reliability, and memory need measurement on
Tesina's minimum supported Macs and the Windows test matrix.

The model installer should therefore use a small signed manifest containing the
model ID, exact revision, URL, byte size, cryptographic digest, license/notice,
minimum memory guidance, and compatible engine version. Download to a temporary
file, verify it, then atomically move it into app data. Model changes should be
explicit, independently removable, and should not overwrite a working model
during a normal Tesina update.

## Where Ollama fits

Ollama is also MIT-licensed and exposes a local HTTP API at
`http://localhost:11434`. It supports macOS, Windows, and Linux, manages model
pulls and storage, and says locally run prompts and responses are not sent to
Ollama. Cloud features can be disabled explicitly. This makes it excellent for
a proof of concept and useful as an optional advanced provider.
([API](https://docs.ollama.com/api/introduction),
[privacy, binding, storage, and updates](https://docs.ollama.com/faq),
[license](https://github.com/ollama/ollama/blob/main/LICENSE))

It is a poor sole dependency for Tesina today. The current Ollama macOS app
requires macOS 14 or newer, while [Tesina supports macOS 12 or newer](../../README.md).
Ollama also runs as a separate login/background application, auto-updates
independently on macOS and Windows, and may expose cloud models unless
local-only mode is enabled. Those are acceptable user choices, but not a
foundation for Tesina's promised self-contained local behavior.
([Ollama macOS requirements](https://docs.ollama.com/macos),
[Ollama FAQ](https://docs.ollama.com/faq))

## Other engines considered

### WebLLM

WebLLM runs models in JavaScript through WebGPU and can cache model artifacts in
browser storage. It exposes an OpenAI-like API with workers and streaming, so it
avoids a native sidecar, but models must be compiled for MLC and inference
depends on WebGPU and the storage behavior of the platform webview. Tauri uses
different system webviews across macOS, Windows, and Linux, which update on
different schedules. That is an unnecessary compatibility risk for a Tauri app
spanning WKWebView on macOS 12 and WebView2 on Windows. It is a useful
capability-gated experiment, but not the strongest dependable foundation for
Tesina's current desktop support contract.
([WebLLM repository and license](https://github.com/mlc-ai/web-llm),
[Tauri webview versions](https://v2.tauri.app/reference/webview-versions/))

### ONNX Runtime GenAI

ONNX Runtime is a credible cross-platform native runtime, and its generative-AI
layer provides tokenization and generation APIs around ONNX models. It becomes
attractive if Tesina chooses a particular ONNX-optimized small model or needs
hardware paths that outperform GGUF on the supported machines. Today it would
add model conversion/variant management and native packaging without making the
Tesina module thinner than the `llama-server` boundary. The GenAI API is still
documented as preview, offers no official Rust binding, and official packages
compile telemetry in and enable it by default unless the application disables
it before initialization (or builds without telemetry). Those are material
costs for Tesina's local-first promise.
([ONNX Runtime GenAI support and preview status](https://github.com/microsoft/onnxruntime-genai),
[model builder](https://github.com/microsoft/onnxruntime-genai/blob/main/src/python/py/models/README.md),
[privacy controls](https://github.com/microsoft/onnxruntime-genai/blob/main/docs/Privacy.md))

### MLX and Core ML

Apple MLX is compelling on Apple silicon, and Core ML is Apple's native model
deployment framework. Either could optimize a macOS-only path, but neither is a
single answer for Tesina's Intel macOS and Windows builds. A second engine and
model format would multiply verification and update work. Revisit an Apple-only
provider only after a cross-platform baseline exists and measurements show a
material benefit. Current MLX installation requires Apple silicon and macOS 14+
for its macOS path, which does not match Tesina's macOS 12/Intel support.
Core ML does support on-device execution and `mlprogram` deployment back to
macOS 12, but requires an Apple-native bridge and still leaves Windows needing a
different engine.
([MLX installation](https://ml-explore.github.io/mlx/build/html/install.html),
[MLX Swift LM](https://github.com/ml-explore/mlx-swift-lm),
[Core ML](https://developer.apple.com/documentation/coreml),
[Core ML model formats](https://apple.github.io/coremltools/docs-guides/source/target-conversion-formats.html))

## Recommended thin boundary

Keep the app-owned API deliberately small:

```text
Svelte UI
  -> typed Tauri commands/events
  -> ai module (policy + lifecycle + model registry)
  -> provider adapter
  -> managed llama-server OR external Ollama
```

The module should expose task-oriented operations such as `checkWriting`,
`quizFromMaterial`, `cancel`, `getStatus`, and `installModel`, not a generic
agent with file or shell tools. Internally, a compact request can contain the
skill version, document language, selected text, limited context, and
constrained generation settings. Keep provider-specific payloads and model
paths out of Svelte and out of the pure APA/DOCX packages.

For the managed sidecar:

- start only when an AI action is requested and stop it with the app;
- bind only to `127.0.0.1` on an available ephemeral port;
- generate a random per-process API key and pass requests through Rust rather
  than granting the webview general localhost access;
- disable the bundled server UI and all tool/MCP/agent features;
- send only the text the user intentionally selected, unless the action clearly
  requests broader document context;
- provide cancellation, loading/download progress, memory/disk preflight, and a
  clear way to remove the model;
- never log prompts, generated text, paper paths, or document contents;
- label optional model-written example rewrites as generated, and keep
  undo/accept/reject semantics intact; diagnostics must not claim AI authorship.

`llama-server` already defaults to loopback and supports an API key, but both
should still be set explicitly. Local-only is a data-flow property, not a claim
that generated text is correct or confidential against other software already
running with the user's privileges.

## Suggested rollout

1. Define a bilingual "slop" rubric and a small human-reviewed fixture set:
   authentic weak prose, competent human prose, AI-assisted prose, English,
   Spanish, and second-language writing. Score issue precision, span accuracy,
   usefulness of the learning question, false positives, JSON validity, latency,
   and peak memory. Do not score authorship accuracy.
2. Implement the language-neutral and bilingual deterministic rules in
   TypeScript. This produces useful feedback even with no model installed and
   establishes exact span/diagnostic UX.
3. Behind a development flag, run the same `writingCoachV1` skill through an
   existing Ollama installation. Compare Qwen3.5 0.8B, Qwen3.5 2B, and SmolLM3
   3B on minimum hardware; include cancellation and repeated-run consistency.
4. If the model materially improves the deterministic layer, implement the
   provider contract with a pinned `llama-server` sidecar and one explicit model
   download. Add packaged smoke coverage for macOS arm64/x64 (including the
   universal app) and Windows x64.
5. Add `quizFromMaterialV1` only after the writing coach works. Evaluate whether
   each answer and explanation is supported by its cited source span, plus
   bilingual clarity and difficulty. Do not score general world knowledge.

The go/no-go question is therefore not technical feasibility. It is whether a
roughly 0.6–2 GB optional model adds enough context-sensitive, bilingual coaching
over deterministic rules to justify the download, memory use, release testing,
and ongoing model license/update responsibility. The educational outcome is
whether students can explain and improve their own work, not an "AI detected"
score.
