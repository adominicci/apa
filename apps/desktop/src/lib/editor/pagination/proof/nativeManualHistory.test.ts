import { history, undo } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

describe("Windows native manual-proof history", () => {
  it("isolates the dead-key edit after moving one authored position", () => {
    let state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, schema.text("invented paragraph")),
      ]),
      plugins: [history()],
    });
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction);
    };
    const pastePos = 5;
    const pastedText = "copied";
    dispatch(
      state.tr.insertText(pastedText, pastePos).setTime(100).setMeta(
        "uiEvent",
        "paste",
      ),
    );
    const baselineJson = state.doc.toJSON();
    const deadKeyPos = pastePos + pastedText.length + 1;
    dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, deadKeyPos)),
    );
    const baselineSelection = {
      from: state.selection.from,
      to: state.selection.to,
    };
    dispatch(state.tr.insertText("é", deadKeyPos).setTime(101));

    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.toJSON()).toEqual(baselineJson);
    expect({ from: state.selection.from, to: state.selection.to }).toEqual(
      baselineSelection,
    );
  });
});
