# Tesina Product Language

Tesina is a local academic writing environment that separates deterministic
document assistance from optional generative learning support. This glossary
keeps those responsibilities and language axes explicit.

## Language

**UI locale**:
The language used by application controls, menus, explanations, and other
interface chrome.
_Avoid_: App language, interface document language

**Document language**:
The language assigned to an essay and used for document content, generated APA
terms, spelling analysis, and writing analysis.
_Avoid_: UI language, automatically detected language

**Authored content**:
Text intentionally entered or accepted by the student as part of an essay.
Generated labels, derived citations, and diagnostics are not authored content.
_Avoid_: All editor text, AI output

## Writing assistance

**Spelling issue**:
A word that the active document-language spelling service does not recognize.
It is advisory and never evidence about authorship or academic misconduct.
_Avoid_: Error, AI-detected word

**Document ignore**:
A term the student has accepted for one essay. It travels with that essay but
does not change spelling behavior in other essays.
_Avoid_: Personal dictionary entry, global ignore

**Personal dictionary**:
A device-local collection of terms the student has accepted across essays. It
can be reviewed, edited, and cleared by the student.
_Avoid_: Document ignore, cloud dictionary

**Writing-coach issue**:
An observable weakness in specificity, evidence, clarity, economy, repetition,
or voice. It describes the prose, not whether a person or model wrote it.
_Avoid_: AI slop, AI detection, authorship score

**Writing-coach skill**:
A versioned bilingual rubric and response contract that explains a
writing-coach issue and asks the student a learning question.
_Avoid_: Autonomous agent, humanizer

**Unslop policy**:
An internal bilingual writing policy that keeps Tesina-generated feedback,
quiz text, and optional examples clear, concrete, and natural without changing
their meaning or source support.
_Avoid_: Humanizer, AI-evasion tool, automatic student-paper rewrite

## Local learning support

**Local inference**:
Optional generation performed on the student's device after the student
enables it and installs a compatible model.
_Avoid_: Cloud AI, built-in spell checking

**Grounded quiz**:
A private retrieval-practice activity built from material the student selected.
Its questions, correct answers, distractor explanations, and feedback are
supported by source spans.
_Avoid_: General-knowledge quiz, ungrounded generation

**Grounded multiple-choice question**:
A quiz question with exactly one correct answer among four options. The student
submits once before Tesina reveals the answer and explains every option.
_Avoid_: Free response, select all that apply, self-graded question

**Source span**:
The exact portion of selected material that supports a quiz answer or writing
observation.
_Avoid_: Citation, model rationale
