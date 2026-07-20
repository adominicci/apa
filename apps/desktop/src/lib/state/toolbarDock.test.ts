import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK,
  parseDock,
  TOOLBAR_DOCKS,
  type ToolbarDock,
} from "./toolbarDock.ts";

describe("parseDock", () => {
  it("acepta cada dock válido", () => {
    const docks: ToolbarDock[] = ["bottom", "top", "left", "right"];
    for (const dock of docks) {
      expect(parseDock(dock)).toBe(dock);
    }
  });

  it("cae al default cuando el campo no existe", () => {
    // Un settings.json escrito antes de esta feature no tiene toolbarDock.
    expect(parseDock(undefined)).toBe("bottom");
    expect(parseDock(null)).toBe("bottom");
  });

  it("cae al default ante valores no reconocidos", () => {
    // Un archivo editado a mano o corrupto no debe llegar a data-dock: un
    // valor desconocido no matchea ninguna regla CSS y deja la barra sin
    // posicionar.
    expect(parseDock("middle")).toBe(DEFAULT_DOCK);
    expect(parseDock(42)).toBe(DEFAULT_DOCK);
    expect(parseDock({})).toBe(DEFAULT_DOCK);
    expect(parseDock("")).toBe(DEFAULT_DOCK);
  });
});

describe("TOOLBAR_DOCKS", () => {
  it("ofrece las cuatro posiciones, empezando por el default", () => {
    expect(TOOLBAR_DOCKS).toEqual(["bottom", "top", "left", "right"]);
    expect(TOOLBAR_DOCKS[0]).toBe(DEFAULT_DOCK);
  });
});
