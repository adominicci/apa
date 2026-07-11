# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); el proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Añadido

- **Motor APA 7 bilingüe** (`@tesina/engine`): 14 tipos de fuente (artículos, libros, capítulos, webs, informes, tesis, ponencias, periódicos/revistas, entradas de diccionario, videos, podcasts, redes sociales, software/datasets y comunicaciones personales), citas parentéticas y narrativas con et al., localizadores, sufijos 2020a/b, desambiguación por apellidos e iniciales, abreviaturas de grupo, y ordenación con `Intl.Collator` (la ñ donde corresponde). En español aplica las convenciones de las normas APA hispanas: "Referencias", "s. f.", "En", "párr.", "y" en vez de "&" con la regla RAE "y"→"e" ante i/hi.
- **Editor** (Tauri 2 + Svelte 5 + TipTap): documento seccionado (resumen con palabras clave, cuerpo con 5 niveles de encabezado APA, apéndices con letra automática), hoja serif con doble espacio y sangrías correctas, citas vivas que se re-renderizan al editar la biblioteca o cambiar el idioma del documento, barra de formato, autosave atómico con respaldos.
- **Biblioteca de ensayos**: crear (ES/EN), renombrar, duplicar; eliminar guarda respaldo con marca de tiempo.
- **Referencias**: panel con bibliografía autogenerada y avisos de obras sin citar; formulario con los 14 tipos; autollenado por DOI (CrossRef) e ISBN (OpenLibrary) sin claves de API.
- **Portada**: variantes estudiante y profesional (titulillo y nota del autor incluidos).
- **Export a Word (.docx)**: estilos reales de Word, portada, saltos de página por sección, encabezados run-in en niveles 4–5, notas de página con número, referencias con sangría francesa — verificado con tests sobre el XML del documento.
- **Vista previa paginada** (Paged.js) con conteo real de páginas e **Imprimir / guardar como PDF**.
- **Interfaz bilingüe** (Paraglide): 152 mensajes en español e inglés, con el idioma de la interfaz independiente del idioma de cada documento.
- Infraestructura: monorepo Deno 2 + npm workspaces, 175 tests (fixtures doradas EN/ES del motor, asserts sobre el DOCX, escenarios de desambiguación), CI y workflow de release multiplataforma (instaladores sin firmar).

[Unreleased]: https://github.com/adominicci/tesina/commits/main
