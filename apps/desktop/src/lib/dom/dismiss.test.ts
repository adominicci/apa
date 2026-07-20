// @vitest-environment jsdom
//
// El único archivo del proyecto que necesita DOM. El resto de la suite corre
// en `node` (ver vitest.config.ts), que es más rápido y es el entorno correcto
// para lógica pura; por eso el entorno se pide acá y no en la config.
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchDismiss } from "./dismiss.ts";

/**
 * jsdom NO implementa el constructor `PointerEvent`. Los listeners se
 * registran por nombre de evento y el handler solo lee `event.target`, así que
 * un MouseEvent sirve igual. No cambiar esto a `new PointerEvent(...)`: rompe
 * los tests con "PointerEvent is not defined".
 */
function pressOn(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
}

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/** Un popover armado como los reales: un disparador y un menú, hermanos. */
function buildPopover(id: string) {
  const trigger = document.createElement("button");
  trigger.id = `${id}-trigger`;
  const menu = document.createElement("div");
  menu.id = `${id}-menu`;
  const item = document.createElement("button");
  menu.append(item);
  document.body.append(trigger, menu);
  return { trigger, menu, item };
}

const stoppers: Array<() => void> = [];

/** Registra y recuerda el stop, para no dejar listeners vivos entre tests. */
function watch(
  inside: HTMLElement[],
  onDismiss: () => void,
  focusOnEscape?: HTMLElement,
) {
  const stop = watchDismiss({ inside, onDismiss, focusOnEscape });
  stoppers.push(stop);
  return stop;
}

afterEach(() => {
  for (const stop of stoppers.splice(0)) stop();
  document.body.innerHTML = "";
});

describe("watchDismiss — presión del puntero", () => {
  it("descarta al presionar fuera de todos los elementos declarados", () => {
    const { trigger, menu } = buildPopover("a");
    const onDismiss = vi.fn();
    watch([menu, trigger], onDismiss);

    pressOn(document.body);

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("no descarta al presionar dentro de CUALQUIERA de los elementos", () => {
    // `inside` es una lista justamente porque en los node views el lápiz y el
    // menú son hermanos: los dos tienen que contar como "adentro".
    const { trigger, menu, item } = buildPopover("b");
    const onDismiss = vi.fn();
    watch([menu, trigger], onDismiss);

    pressOn(trigger);
    pressOn(menu);
    pressOn(item); // descendiente del menú, no el menú mismo

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("descarta al presionar un hermano que no está en la lista", () => {
    // El caso que falla si alguien "simplifica" anclando al ancestro común:
    // en una tabla, ese ancestro es la tabla entera, y presionar una celda
    // tiene que cerrar el menú.
    const { trigger, menu } = buildPopover("c");
    const otherElement = document.createElement("div");
    document.body.append(otherElement);
    const onDismiss = vi.fn();
    watch([menu, trigger], onDismiss);

    pressOn(otherElement);

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("watchDismiss — teclado", () => {
  it("descarta con Escape y devuelve el foco al disparador", () => {
    const { trigger, menu, item } = buildPopover("d");
    item.focus();
    const onDismiss = vi.fn();
    watch([menu, trigger], onDismiss, trigger);

    pressKey("Escape");

    expect(onDismiss).toHaveBeenCalledOnce();
    // Sin esto el foco quedaría en <body> y un usuario de teclado volvería al
    // principio del documento.
    expect(document.activeElement).toBe(trigger);
  });

  it("ignora otras teclas", () => {
    const { trigger, menu } = buildPopover("e");
    const onDismiss = vi.fn();
    watch([menu, trigger], onDismiss);

    pressKey("Enter");
    pressKey("a");
    pressKey("Tab");

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("watchDismiss — un solo popover abierto a la vez", () => {
  it("descarta el anterior al registrar uno nuevo", () => {
    // Regresión del bug que encontró CodeRabbit en el PR #14: abrir por
    // teclado (Tab + Enter) no dispara ningún evento de puntero, así que sin
    // registro central quedaban dos menús abiertos a la vez.
    const first = buildPopover("f1");
    const second = buildPopover("f2");
    const dismissFirst = vi.fn();
    const dismissSecond = vi.fn();

    watch([first.menu, first.trigger], dismissFirst);
    watch([second.menu, second.trigger], dismissSecond);

    expect(dismissFirst).toHaveBeenCalledOnce();
    expect(dismissSecond).not.toHaveBeenCalled();
  });

  it("Escape sólo alcanza al popover activo", () => {
    // El síntoma concreto del bug: con dos abiertos, Escape corría AMBOS
    // handlers y llamaba focus() dos veces.
    const first = buildPopover("g1");
    const second = buildPopover("g2");
    const dismissFirst = vi.fn();
    const dismissSecond = vi.fn();

    watch([first.menu, first.trigger], dismissFirst, first.trigger);
    watch([second.menu, second.trigger], dismissSecond, second.trigger);
    dismissFirst.mockClear(); // ya lo descartó el registro del segundo

    pressKey("Escape");

    expect(dismissSecond).toHaveBeenCalledOnce();
    expect(dismissFirst).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(second.trigger);
  });

  it("el desmontaje de uno viejo no borra el registro de uno nuevo", () => {
    // La comparación de identidad dentro de `stop`. Sin ella, llamar el stop
    // rezagado del primero limpiaría el registro del segundo, y a partir de
    // ahí un tercero ya no descartaría a nadie.
    const first = buildPopover("h1");
    const second = buildPopover("h2");
    const third = buildPopover("h3");
    const stopFirst = watch([first.menu, first.trigger], () => {});
    const dismissSecond = vi.fn();
    watch([second.menu, second.trigger], dismissSecond);

    stopFirst(); // teardown tardío del primero, ya descartado
    watch([third.menu, third.trigger], () => {});

    expect(dismissSecond).toHaveBeenCalledOnce();
  });
});

describe("watchDismiss — desregistro", () => {
  it("deja de escuchar después de stop()", () => {
    const { trigger, menu } = buildPopover("i");
    const onDismiss = vi.fn();
    const stop = watch([menu, trigger], onDismiss);

    stop();
    pressOn(document.body);
    pressKey("Escape");

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stop() es idempotente", () => {
    // El `onDismiss` del llamador cierra el popover, lo que en Svelte vuelve a
    // entrar por el teardown del attachment cuando la condición se hace falsy.
    const { trigger, menu } = buildPopover("j");
    const onDismiss = vi.fn();
    const stop = watch([menu, trigger], onDismiss);

    expect(() => {
      stop();
      stop();
      stop();
    }).not.toThrow();
    pressOn(document.body);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("no vuelve a llamar onDismiss cuando éste ya cerró por su cuenta", () => {
    // Camino real: presión afuera → dismiss() → onDismiss() → el componente
    // cierra → su stop corre otra vez. Debe quedar en una sola llamada.
    const { trigger, menu } = buildPopover("k");
    let stop: (() => void) | null = null;
    const onDismiss = vi.fn(() => stop?.());
    stop = watch([menu, trigger], onDismiss);

    pressOn(document.body);

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
