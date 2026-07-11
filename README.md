# Tesina

**ES** · Procesador de textos académicos que aplica el formato APA 7 por ti: portada, márgenes, interlineado, encabezados, citas en el texto y lista de referencias — en español o en inglés. Escribe; del formato se encarga Tesina.

**EN** · An academic word processor that handles APA 7 formatting for you: title page, margins, spacing, headings, in-text citations, and the reference list — in Spanish or English. You write; Tesina does the formatting.

> Proyecto en desarrollo activo / under active development. Aún no hay una versión estable.

## ¿Por qué? / Why?

Creado por un ex profesor universitario cansado de ver trabajos con formato APA incorrecto. Tesina es open source (MIT), local-first (tus ensayos son archivos tuyos, sin cuentas ni nube) y funciona en macOS, Windows y Linux.

A diferencia de otras herramientas, el **idioma del documento** es independiente del idioma de la interfaz: un ensayo en español usa "Referencias", "y" en vez de "&", "s. f." en vez de "n.d.", fechas en español — todo según las convenciones APA en español.

## Características (v1 en construcción)

- Portada (estudiante o profesional), resumen/abstract, cuerpo con los 5 niveles de encabezado APA, apéndices y lista de referencias generada automáticamente.
- Gestor de referencias con ~14 tipos de fuente, reutilizable entre ensayos; autollenado por DOI, ISBN o URL; import BibTeX.
- Citas en el texto (parentéticas y narrativas) con reglas APA completas: et al., desambiguación 2020a/2020b, localizadores de página/párrafo.
- Export a **DOCX** (abre perfecto en Word — es lo que se entrega) y PDF.
- Interfaz en español e inglés; modo oscuro.

## Stack

Tauri 2 (Rust) · Deno 2 · Svelte 5 · TipTap/ProseMirror · TypeScript

```bash
deno install        # instala dependencias del workspace
deno task dev       # abre la app en modo desarrollo
deno task test      # corre las suites (Vitest)
```

### Notas de toolchain

Resultados de los gates de verificación del workspace (2026-07-11):

- **Deno 2.1.7 + npm workspaces**: `deno install` resuelve el workspace (`packages/*`, `apps/*`) y Vitest corre bajo Deno sin configuración extra. ✅
- **Sombras de nombres de tareas**: al ejecutar `deno task X` dentro de un miembro del workspace, una tarea `X` del `deno.json` raíz **gana** sobre el script `X` del `package.json` del miembro. Con `beforeDevCommand: "deno task dev"` eso causaba recursión infinita. Por eso los scripts del app usan nombres únicos: `vite:dev`, `vite:build`, `app:check`.
- **Rust ≥ 1.88 requerido**: el árbol de dependencias de Tauri 2 (mediados de 2026) usa `edition2024`; con Rust 1.84 el build falla con "feature `edition2024` is required". Solución: `rustup update stable`.

## Licencia

[MIT](LICENSE). Tesina no está afiliada a la American Psychological Association; "APA" se usa solo para describir el estilo de formato que la app produce.
