# Tesina

**ES** · Procesador de textos académicos que aplica el formato APA 7 por ti: portada, márgenes, interlineado, encabezados, citas en el texto y lista de referencias — en español o en inglés. Escribe; del formato se encarga Tesina.

**EN** · An academic word processor that handles APA 7 formatting for you: title page, margins, spacing, headings, in-text citations, and the reference list — in Spanish or English. You write; Tesina does the formatting.

> En desarrollo activo. El núcleo ya funciona (ver abajo); aún no hay instaladores publicados.

## ¿Por qué? / Why?

Creado por un ex profesor universitario cansado de ver trabajos con formato APA incorrecto. Tesina es open source (MIT), local-first (tus ensayos son archivos tuyos, sin cuentas ni nube) y funciona en macOS, Windows y Linux.

A diferencia de otras herramientas, el **idioma del documento** es independiente del idioma de la interfaz: un ensayo en español usa "Referencias", "y" en vez de "&" (con la regla RAE "y"→"e" ante i/hi), "s. f." en vez de "n.d.", fechas en español — todo según las convenciones APA en español. Cambiar el idioma retraduce el documento entero al instante.

## Lo que ya funciona

- **Biblioteca de ensayos**: crear (ES/EN), renombrar, duplicar; eliminar guarda respaldo en `backups/`.
- **Editor APA seccionado**: resumen con palabras clave, cuerpo con los 5 niveles de encabezado, apéndices con letra automática; hoja blanca con serif, doble espacio y sangrías correctas.
- **Citas vivas**: inserta citas parentéticas o narrativas desde tu biblioteca (multi-obra, localizadores de página/párrafo); el motor aplica et al., sufijos 2020a/b, iniciales por apellidos repetidos y abreviaturas de grupo — y se re-renderizan solas al editar la biblioteca o cambiar el idioma.
- **Bibliografía automática**: ordenada y formateada por el motor, con avisos de obras sin citar.
- **Portada**: variantes estudiante y profesional (con titulillo y nota del autor).
- **Autollenado**: pega un DOI o ISBN y el formulario se rellena solo (CrossRef / OpenLibrary, sin API keys).
- **Export a Word**: un clic → `.docx` con portada, secciones en páginas nuevas, encabezados reales de Word, citas y referencias con sangría francesa. 144 tests automatizados, incluidos asserts sobre el XML del documento.

## Instalación (builds sin firmar)

Tesina se distribuye **únicamente por GitHub Releases** — en macOS como `.dmg` (no está ni estará en la Mac App Store). Los instaladores no están firmados (no hay cuenta de Apple Developer ni certificado de Windows todavía), así que el sistema mostrará una advertencia la primera vez:

- **macOS**: al abrir el `.dmg` y arrastrar Tesina a Aplicaciones, macOS dirá que no puede verificar el desarrollador. Haz **clic derecho sobre Tesina.app → Abrir → Abrir** (solo la primera vez). En macOS 15+ puede hacer falta ir a **Ajustes del Sistema → Privacidad y seguridad → Abrir de todos modos**.
- **Windows**: SmartScreen mostrará "Windows protegió tu PC". Pulsa **Más información → Ejecutar de todas formas**.

El código es abierto: si prefieres, compílalo tú mismo con las instrucciones de abajo.

## Cómo probarlo

```bash
deno install          # dependencias del workspace
deno task dev         # abre la app (compila Rust la primera vez)
deno task test        # suites completas
deno task spike:docx  # genera samples/*.docx para revisarlos en Word
```

Requisitos: Deno 2.x, Rust estable ≥ 1.88 (`rustup update stable`), y en Linux las dependencias de Tauri 2.

## Hoja de ruta

- Gestor completo de referencias (colecciones, más tipos de fuente, editar existentes)
- Autollenado por URL e import BibTeX
- Vista previa paginada e impresión/PDF (M5)
- Empaquetado firmado, actualizador y UI en inglés completa (M6)
- Después de v1: paginación en vivo, búsqueda académica integrada, ecuaciones

### Notas de toolchain

Resultados de los gates de verificación del workspace (2026-07-11):

- **Deno 2.1.7 + npm workspaces**: `deno install` resuelve el workspace (`packages/*`, `apps/*`) y Vitest corre bajo Deno sin configuración extra. ✅
- **Sombras de nombres de tareas**: al ejecutar `deno task X` dentro de un miembro del workspace, una tarea `X` del `deno.json` raíz **gana** sobre el script `X` del `package.json` del miembro. Con `beforeDevCommand: "deno task dev"` eso causaba recursión infinita. Por eso los scripts del app usan nombres únicos: `vite:dev`, `vite:build`, `app:check`.
- **Rust ≥ 1.88 requerido**: el árbol de dependencias de Tauri 2 (mediados de 2026) usa `edition2024`; con Rust 1.84 el build falla con "feature `edition2024` is required". Solución: `rustup update stable`.

## Licencia

[MIT](LICENSE). Tesina no está afiliada a la American Psychological Association; "APA" se usa solo para describir el estilo de formato que la app produce.
