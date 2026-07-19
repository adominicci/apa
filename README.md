# Tesina

**ES** · Procesador de textos académicos que aplica el formato APA 7 por ti: portada, márgenes, interlineado, encabezados, citas en el texto y lista de referencias — en español o en inglés. Escribe; del formato se encarga Tesina.

**EN** · An academic word processor that handles APA 7 formatting for you: title page, margins, spacing, headings, in-text citations, and the reference list — in Spanish or English. You write; Tesina does the formatting.

> En desarrollo activo. El núcleo ya funciona (ver abajo); aún no hay instaladores publicados.

## ¿Por qué? / Why?

Creado por un ex profesor universitario cansado de ver trabajos con formato APA incorrecto. Tesina es open source (MIT), local-first (tus ensayos son archivos tuyos, sin cuentas ni nube) y funciona en macOS, Windows y Linux.

A diferencia de otras herramientas, el **idioma del documento** es independiente del idioma de la interfaz: un ensayo en español usa "Referencias", "y" en vez de "&" (con la regla RAE "y"→"e" ante i/hi), "s. f." en vez de "n.d.", fechas en español — todo según las convenciones APA en español. Cambiar el idioma retraduce el documento entero al instante.

## Lo que ya funciona

- **Entorno de tres hojas**: cada proyecto abre como tres hojas tamaño carta apiladas — portada editable sobre la propia página, cuerpo, y página de referencias que se llena sola al citar.
- **Biblioteca de ensayos**: crear (ES/EN), renombrar, duplicar; las tarjetas muestran curso, profesor y las primeras líneas; eliminar guarda respaldo en `backups/`.
- **Editor APA seccionado**: resumen con palabras clave, cuerpo con los 5 niveles de encabezado, apéndices con letra automática; hoja blanca con la fuente APA que elijas, doble espacio y sangrías correctas.
- **Estructura**: menús de encabezados (N1–N5) y listas (viñeta, número o letra, con sangrar/reducir y numeración anidada 1 → a → i), más **tablas** con bordes APA y **figuras** con imagen, autonumeradas ("Tabla 1", "Figura 1") en editor, vista previa y Word.
- **Selector de fuente**: un menú en la barra flotante muestra la fuente actual y cambia todo el ensayo —editor, portada, referencias, vista previa y Word— a cualquiera de las 7 fuentes que APA 7 aprueba (serif: Times New Roman, Georgia, Computer Modern; sans serif: Aptos, Calibri, Arial, Lucida Sans Unicode), cada una en su tamaño prescrito.
- **Citas vivas**: inserta citas parentéticas o narrativas desde tu biblioteca (multi-obra, localizadores de página/párrafo); el motor aplica et al., sufijos 2020a/b, iniciales por apellidos repetidos y abreviaturas de grupo — y se re-renderizan solas al editar la biblioteca o cambiar el idioma.
- **Bibliografía automática**: ordenada y formateada por el motor, con avisos de obras sin citar.
- **Gestor de referencias**: una **Biblioteca a pantalla completa** (desde Inicio o desde el editor con "Gestionar") para **editar** cualquier referencia existente, agruparlas en **colecciones** reutilizables (una referencia puede estar en varias) y eliminarlas con seguridad — el aviso te dice en cuántos ensayos se cita, y como cada ensayo guarda su propia copia, las citas no se rompen: al reabrir un ensayo, una referencia borrada se restaura desde esa copia.
- **Meta de palabras**: la tarjeta de progreso del esquema muestra el conteo actual frente a una meta editable, guardada con cada ensayo.
- **Catálogo APA completo**: todos los formatos de la página de ejemplos de APA Style, agrupados por categoría — periódicos (revista académica, magacín, periódico, blog), libros (incl. ilustrados, obras religiosas, partituras), capítulos y entradas de diccionario/Wikipedia, informes y literatura gris (folleto, hoja informativa, comunicado, white paper, normas ISO, códigos de ética), congresos (ponencia, póster, sesión, conferencia magistral, actas) y tesis, preprints/ERIC y manuscritos no publicados, datos/software/apps/modelos de IA, audiovisual (película, serie y episodio, YouTube, TED, MOOC, seminario web, diapositivas, radio, transcripciones, pódcast completo o episodio, álbum, canción, obras de arte e imágenes) y en línea (web, redes sociales, foros, comunicación personal).
- **Portada**: variantes estudiante y profesional (con titulillo y nota del autor).
- **Autollenado**: pega un DOI, un ISBN o una URL y el formulario se rellena solo (CrossRef / OpenLibrary / metadatos de la página, sin API keys); si una web no es legible, un aviso claro te pide escribirla a mano.
- **Importar BibTeX**: trae de golpe la bibliografía exportada de Zotero, Mendeley o Google Scholar (`.bib`), con una revisión previa que mapea cada entrada al tipo APA correcto, avisa de duplicados y datos faltantes, y te deja elegir qué importar y a qué colección.
- **Vista previa e impresión**: paginado real con Paged.js, conteo de páginas e impresión / guardar como PDF.
- **Export a Word**: un clic → `.docx` con portada, secciones en páginas nuevas, encabezados reales de Word, listas anidadas, tablas con bordes APA, figuras con imagen, citas y referencias con sangría francesa. 300 tests automatizados, incluidos asserts sobre el XML del documento.
- **Actualización automática**: al abrir, Tesina comprueba si hay una versión más nueva publicada y muestra un aviso para **actualizar y reiniciar** con un clic; los paquetes se firman en CI con una clave propia y tus ensayos no se tocan.

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

- Firma y notarización de los instaladores con cuenta de Apple Developer (el actualizador automático dentro de la app ya funciona; falta la firma de Apple para evitar el aviso de Gatekeeper)
- Después de v1: paginación en vivo, búsqueda académica integrada, ecuaciones

### Notas de toolchain

Resultados de los gates de verificación del workspace (2026-07-11):

- **Deno 2.1.7 + npm workspaces**: `deno install` resuelve el workspace (`packages/*`, `apps/*`) y Vitest corre bajo Deno sin configuración extra. ✅
- **Sombras de nombres de tareas**: al ejecutar `deno task X` dentro de un miembro del workspace, una tarea `X` del `deno.json` raíz **gana** sobre el script `X` del `package.json` del miembro. Con `beforeDevCommand: "deno task dev"` eso causaba recursión infinita. Por eso los scripts del app usan nombres únicos: `vite:dev`, `vite:build`, `app:check`.
- **Rust ≥ 1.88 requerido**: el árbol de dependencias de Tauri 2 (mediados de 2026) usa `edition2024`; con Rust 1.84 el build falla con "feature `edition2024` is required". Solución: `rustup update stable`.

## Licencia

[MIT](LICENSE). Tesina no está afiliada a la American Psychological Association; "APA" se usa solo para describir el estilo de formato que la app produce.
