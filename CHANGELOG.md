# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); el proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Añadido

- **Motor APA 7 bilingüe** (`@tesina/engine`): 20 tipos de fuente (artículos, libros, capítulos, webs, informes, tesis, ponencias, periódicos/revistas, entradas de diccionario, preprints, obras no publicadas, videos, películas, episodios de TV, podcasts, música, obras de arte, redes sociales, software/datasets y comunicaciones personales), citas parentéticas y narrativas con et al., localizadores, sufijos 2020a/b, desambiguación por apellidos e iniciales, abreviaturas de grupo, y ordenación con `Intl.Collator` (la ñ donde corresponde). En español aplica las convenciones de las normas APA hispanas: "Referencias", "s. f.", "En", "párr.", "y" en vez de "&" con la regla RAE "y"→"e" ante i/hi.
- **Entorno de tres hojas**: cada proyecto abre como tres hojas tamaño carta apiladas — portada editable directamente sobre la página, cuerpo, y página de referencias que se llena sola a medida que citas.
- **Editor** (Tauri 2 + Svelte 5 + TipTap): documento seccionado (resumen con palabras clave, cuerpo con 5 niveles de encabezado APA, apéndices con letra automática), hoja con la fuente APA elegida, doble espacio y sangrías correctas, citas vivas que se re-renderizan al editar la biblioteca o cambiar el idioma del documento, autosave atómico con respaldos.
- **Menús de estructura**: encabezados N1–N5, listas con viñeta, número o letra con sangrar/reducir (numeración anidada 1 → a → i), e inserción de **tablas** (cuadrícula editable con bordes APA) y **figuras** con imagen, ambas autonumeradas ("Tabla 1", "Figura 1") en editor, vista previa y DOCX.
- **Selección de fuente**: elige entre las 6 fuentes que APA 7 aprueba (Times New Roman 12, Georgia 11, Computer Modern 10, Calibri 11, Arial 11, Lucida Sans Unicode 10), con su tamaño prescrito, aplicada en editor, vista previa y DOCX.
- **Cambio de idioma del documento** sobre la marcha: las etiquetas de sección, términos y mensajes se retraducen sin mezclar idiomas.
- **Biblioteca de ensayos**: crear (ES/EN), renombrar, duplicar; las tarjetas muestran curso, profesor y las primeras líneas del documento; eliminar guarda respaldo con marca de tiempo.
- **Gestor de referencias a pantalla completa** (Biblioteca): editar cualquier referencia existente reutilizando el formulario en modo edición, **colecciones** tipo etiqueta (una referencia puede pertenecer a varias, con alta/renombrado/borrado en línea) y borrado seguro que escanea todos los ensayos y avisa en cuántos se cita la referencia. Al reabrir un ensayo se reconcilian sus citas contra la biblioteca: una referencia borrada se restaura desde la copia denormalizada del ensayo (`referencesSnapshot`), así que las citas nunca quedan huérfanas. Accesible desde Inicio y desde el editor ("Gestionar"). `library.json` gana un campo `collections` opcional y aditivo (sin subir `schemaVersion`).
- **Meta de palabras editable**: la tarjeta de progreso del esquema compara el conteo actual con una meta ajustable, persistida en el ensayo.
- **Referencias**: panel con bibliografía autogenerada y avisos de obras sin citar; formulario con los 20 tipos; autollenado por DOI (CrossRef), ISBN (OpenLibrary) y **URL** (metadatos Highwire/OpenGraph/JSON-LD, con aviso claro para escribir a mano si la página no es legible), sin claves de API.
- **Importar BibTeX (`.bib`)**: elige un archivo exportado de Zotero, Mendeley o Google Scholar y un modal de revisión muestra cada entrada ya mapeada a su tipo APA (los tipos BibTeX/biblatex se traducen a los 20 del motor; los desconocidos caen a un tipo razonable con aviso), con avisos de datos faltantes y **duplicados** desmarcados por defecto (por DOI, y por título+año cuando no hay DOI, contra la biblioteca y contra el propio archivo). Eliges cuáles importar y a qué colección, y entran en un solo guardado. El parseo usa `@retorquere/bibtex-parser` (ISC): convierte los escapes LaTeX a Unicode y entiende autores estructurados. Accesible desde la biblioteca y desde el formulario de referencia del editor.
- **Portada**: variantes estudiante y profesional (titulillo y nota del autor incluidos).
- **Export a Word (.docx)**: estilos reales de Word, portada, saltos de página por sección, encabezados run-in en niveles 4–5, listas anidadas, tablas con bordes APA, figuras con imagen, notas de página con número, referencias con sangría francesa — verificado con tests sobre el XML del documento.
- **Vista previa paginada** (Paged.js) con conteo real de páginas e **Imprimir / guardar como PDF**.
- **Interfaz bilingüe** (Paraglide): 383 mensajes en español e inglés, con el idioma de la interfaz independiente del idioma de cada documento.
- **Diseño**: sistema de tokens (claro/oscuro) y un componente de modal compartido aplicado a toda la app.
- **Empaquetado (M6)**: ícono propio de Tesina en todas las plataformas y metadatos de bundle al día para los instaladores.
- Infraestructura: monorepo Deno 2 + npm workspaces, 290 tests (fixtures doradas EN/ES del motor, asserts sobre el DOCX, mapeo y dedupe de BibTeX, escenarios de desambiguación), CI y workflow de release multiplataforma (instaladores sin firmar).

[Unreleased]: https://github.com/adominicci/tesina/commits/main
