import type { DocLocale } from "@tesina/engine";
import type { CoachCategory, CoachMessageDescriptor } from "../types.ts";

export const COACH_CORPUS_VERSION = "coach-corpus-v1" as const;
export const COACH_RENDER_CATALOG_VERSION = "coach-render-catalog-v1" as const;
export type CorpusCohort =
  | "weak"
  | "competent"
  | "ai-assisted"
  | "second-language";

export interface ProposedObservation {
  id: string;
  category: CoachCategory;
  from: number;
  to: number;
}

export interface CoachCorpusFixture {
  id: string;
  documentLanguage: DocLocale;
  cohort: CorpusCohort;
  text: string;
  origin: "tesina-lt03-synthetic-v1";
  license: "MIT";
  sourceUrl: null;
  attribution: "Tesina contributors";
  deIdentified: true;
  expectedClean: boolean;
  proposedObservations: ProposedObservation[];
}

export const REVIEWER_SLOTS = Object.freeze(
  [
    {
      slot: 1,
      role: "independent-bilingual-reviewer",
      reviewerId: null,
      bilingualAttestation: null,
      independenceAttestation: null,
    },
    {
      slot: 2,
      role: "independent-bilingual-reviewer",
      reviewerId: null,
      bilingualAttestation: null,
      independenceAttestation: null,
    },
  ] as const,
);

const WEAK_PARAGRAPHS = {
  en: {
    specificity: [
      "The attendance policy changed in many ways during the autumn pilot at the community campus.",
      "Various aspects of the library workshop were revised after the spring observation period.",
      "The bicycle survey shifted in many ways after the city opened the protected river route.",
      "Various aspects of the greenhouse procedure changed when temperature controls were recalibrated.",
      "The oral-history archive expanded in many ways during the neighborhood preservation project.",
      "Various aspects of the shoreline sampling plan were revised after the first tidal cycle.",
      "The peer-mentoring program developed in many ways during its first semester of operation.",
      "Various aspects of the food-waste audit changed when residence halls adopted smaller bins.",
    ],
    evidence: [
      "The coordinator clearly proves that weekly reminders improved attendance across every evening section.",
      "Research clearly shows that the new catalog exercise improved every participant's search accuracy.",
      "The field report clearly proves that painted intersections reduced all conflicts between riders and drivers.",
      "Research clearly shows that the revised watering interval increased growth for every basil plant.",
      "The archive clearly proves that public listening sessions increased interest in every recorded interview.",
      "Research clearly shows that the restored marsh removed every measured pollutant from incoming water.",
      "The evaluation clearly proves that mentor meetings eliminated uncertainty for every first-year participant.",
      "Research clearly shows that smaller bins reduced every kind of discarded food in the residence halls.",
    ],
    clarity: [
      "Because the advising team compared six weeks of appointment logs across three departments, although several records lacked a final outcome code, while counselors changed their scheduling practice midway through the pilot, the report combines enrollment patterns, staffing limits, travel constraints, and cancellation reasons in one sentence, which makes the sequence difficult to follow but preserves each measured detail for later analysis.",
      "Although the librarians recorded completion time for each search exercise, because the workshop groups entered with different levels of database experience, while two facilitators offered extra demonstrations during the second session, the analysis discusses keyword choice, filter use, source evaluation, and confidence ratings together, which obscures when each observation occurred but retains the distinctions needed for a later table.",
      "While volunteers counted bicycles at four intersections during morning and evening periods, because rain interrupted two scheduled observations, although the city changed signal timing before the final count, the report compares rider volume, turning behavior, helmet use, and near conflicts across every location, which complicates the temporal comparison but provides enough detail to reconstruct the collection schedule.",
      "Because the greenhouse sensors logged temperature every fifteen minutes, while assistants measured soil moisture only at midday, although one tray moved closer to the cooling vent during the third week, the summary links leaf count, stem height, water volume, and room conditions across all observations, which leaves the causal order uncertain but documents each procedural change for replication.",
      "Although the archive team indexed each interview by date and neighborhood, because several recordings mentioned the same storefront under different names, while the public catalog grouped speakers by decade, the narrative connects migration, business ownership, street design, and community celebrations in one extended account, which blurs the source transitions but preserves the historical relationships identified during indexing.",
      "While researchers collected water at high and low tide, because the northern station became inaccessible after heavy rain, although laboratory calibration changed between the first and second batches, the results combine salinity, suspended sediment, dissolved oxygen, and nutrient readings from all stations, which hinders direct comparison but records the conditions needed to interpret each sample.",
      "Because mentors recorded meeting topics in weekly logs, although participants could skip questions they considered private, while program staff changed the reflection prompt after midterm, the evaluation combines study planning, campus navigation, financial concerns, and social adjustment across one broad summary, which makes individual pathways difficult to distinguish but retains the full set of coded themes.",
      "Although student teams weighed each collection bin after dinner, because weekend meal schedules differed from weekday service, while two halls began compost education before the others, the report combines plate waste, kitchen scraps, participation counts, and menu changes across the entire month, which complicates comparison between halls but documents the operational context for every measurement.",
    ],
    economy: [
      "The committee met in order to compare the appointment logs with the published schedule.",
      "The observers extended the session due to the fact that several catalog tasks remained unfinished.",
      "Volunteers returned before sunrise in order to observe the first commuter period.",
      "The team replaced two sensors due to the fact that their midday readings drifted outside tolerance.",
      "The archivists created a cross-reference in order to connect alternate storefront names.",
      "The crew used a second launch due to the fact that the northern channel became too shallow.",
      "Staff scheduled an extra orientation in order to explain the revised reflection prompt.",
      "The coordinators added a weekend shift due to the fact that dining hours ended later on Saturdays.",
    ],
    repetition: [
      "Local attendance records shaped the initial schedule, and local attendance records shaped the final recommendation after the pilot.",
      "Focused catalog practice improved the first search round, while focused catalog practice improved the final source check.",
      "Morning bicycle counts informed the route map, and morning bicycle counts informed the safety discussion presented to planners.",
      "Measured soil moisture guided the watering schedule, and measured soil moisture guided the interpretation of plant growth.",
      "Recorded neighborhood memories supported the exhibit plan, while recorded neighborhood memories supported the catalog description shown online.",
      "Tidal water samples anchored the laboratory table, and tidal water samples anchored the discussion of seasonal variation.",
      "Weekly mentor logs informed the training revision, and weekly mentor logs informed the end-of-term evaluation shared with staff.",
      "Measured dining waste shaped the poster campaign, while measured dining waste shaped the recommendation for smaller serving trays.",
    ],
    repetitionMatch: [
      "local attendance records shaped",
      "focused catalog practice improved",
      "morning bicycle counts informed",
      "measured soil moisture guided",
      "recorded neighborhood memories supported",
      "tidal water samples anchored",
      "weekly mentor logs informed",
      "measured dining waste shaped",
    ],
    voice: [
      "It is important to note that the evening sections lost fewer participants after reminders began.",
      "Needless to say, the final workshop group completed more searches within the allotted period.",
      "It is important to note that the river intersection carried the largest morning bicycle volume.",
      "Needless to say, the tray beside the cooling vent developed the shortest stems.",
      "It is important to note that three interviews described the same corner market before renovation.",
      "Needless to say, the northern station produced the widest range of salinity readings.",
      "It is important to note that planning questions appeared most often before the midterm period.",
      "Needless to say, the hall with early compost education recorded the smallest weekend total.",
    ],
  },
  es: {
    specificity: [
      "La política de asistencia cambió de alguna manera durante el programa piloto del recinto comunitario.",
      "En diversos sentidos, el taller de biblioteca fue revisado después del periodo de observación primaveral.",
      "El estudio de bicicletas cambió de alguna manera después de abrir la ruta protegida junto al río.",
      "En diversos sentidos, el procedimiento del invernadero cambió al recalibrar los controles de temperatura.",
      "El archivo de historia oral creció de alguna manera durante el proyecto de conservación del barrio.",
      "En diversos sentidos, el plan de muestreo costero fue revisado después del primer ciclo de mareas.",
      "El programa de mentoría se desarrolló de alguna manera durante su primer semestre de funcionamiento.",
      "En diversos sentidos, la auditoría de alimentos cambió cuando las residencias adoptaron recipientes pequeños.",
    ],
    evidence: [
      "El coordinador demuestra claramente que los recordatorios semanales mejoraron la asistencia en cada sección nocturna.",
      "Los datos confirman que el nuevo ejercicio de catálogo mejoró todas las búsquedas realizadas por participantes.",
      "El informe demuestra claramente que las intersecciones pintadas redujeron todos los conflictos observados entre vehículos.",
      "Los datos confirman que el nuevo intervalo de riego aumentó el crecimiento de todas las plantas.",
      "El archivo demuestra claramente que las audiciones públicas aumentaron el interés por cada entrevista grabada.",
      "Los datos confirman que el humedal restaurado eliminó todos los contaminantes medidos en el agua.",
      "El estudio demuestra claramente que las reuniones eliminaron toda incertidumbre entre participantes de primer año.",
      "Los datos confirman que los recipientes pequeños redujeron todos los alimentos desechados en las residencias.",
    ],
    clarity: [
      "Porque el equipo de orientación comparó seis semanas de citas en tres departamentos, aunque varios registros carecían de un código final, mientras el personal modificó los horarios a mitad del programa, el informe reúne patrones de matrícula, límites de personal, tiempos de traslado y cancelaciones en una sola oración, pero conserva cada dato necesario cuando otras personas reconstruyan la secuencia del análisis.",
      "Aunque el personal bibliotecario registró el tiempo de cada ejercicio, porque los grupos llegaron con distinta experiencia en bases de datos, mientras dos facilitadores ofrecieron demostraciones adicionales durante la segunda sesión, el análisis discute palabras clave, filtros, evaluación de fuentes y confianza en conjunto, pero no distingue con claridad cuándo ocurrió cada observación ni cómo cambió el desempeño entre tareas.",
      "Mientras el voluntariado contó bicicletas en cuatro intersecciones durante la mañana y la tarde, porque la lluvia interrumpió dos observaciones programadas, aunque la ciudad ajustó los semáforos antes del conteo final, el informe compara volumen, giros, uso de casco y conflictos en cada lugar, pero mezcla periodos distintos cuando presenta las tendencias y dificulta reconocer cuáles condiciones pertenecen a cada fecha.",
      "Porque los sensores registraron la temperatura cada quince minutos, mientras el equipo midió la humedad del suelo solamente al mediodía, aunque una bandeja fue trasladada cerca de la ventilación durante la tercera semana, el resumen relaciona hojas, altura, volumen de agua y condiciones ambientales, pero deja incierto el orden causal cuando integra todos los cambios del procedimiento en una sola explicación extensa.",
      "Aunque el equipo archivó cada entrevista por fecha y barrio, porque varias grabaciones mencionaron la misma tienda con nombres distintos, mientras el catálogo agrupó las voces por década, la narración conecta migración, comercios, diseño urbano y celebraciones comunitarias, pero confunde las transiciones entre fuentes cuando resume en una sola oración todas las relaciones identificadas durante la catalogación.",
      "Mientras el equipo recogió agua durante la marea alta y baja, porque la estación norte quedó inaccesible después de la lluvia, aunque la calibración del laboratorio cambió entre los primeros lotes, los resultados combinan salinidad, sedimentos, oxígeno y nutrientes de todos los puntos, pero dificultan la comparación directa cuando presentan condiciones diferentes como si pertenecieran al mismo periodo de muestreo.",
      "Porque cada mentor registró los temas de las reuniones semanales, aunque las personas podían omitir preguntas privadas, mientras el programa cambió la reflexión después de los exámenes parciales, la evaluación combina planificación académica, orientación universitaria, inquietudes económicas y adaptación social, pero no separa las trayectorias individuales cuando resume en una sola oración el conjunto completo de temas codificados.",
      "Aunque los equipos pesaron cada recipiente después de la cena, porque los horarios del fin de semana diferían del servicio regular, mientras dos residencias comenzaron antes la educación sobre composta, el informe combina sobras, residuos de cocina, participación y cambios de menú durante todo el mes, pero complica la comparación entre edificios cuando integra condiciones operativas diferentes dentro de una sola oración extensa.",
    ],
    economy: [
      "El comité se reunió con el fin de comparar las citas registradas con el horario publicado.",
      "La sesión se extendió debido al hecho de que varias búsquedas del catálogo quedaron incompletas.",
      "El voluntariado regresó antes del amanecer con el fin de observar el primer periodo de tránsito.",
      "El equipo reemplazó dos sensores debido al hecho de que sus lecturas excedieron la tolerancia.",
      "El personal creó referencias cruzadas con el fin de conectar los nombres alternos de las tiendas.",
      "El grupo utilizó otra lancha debido al hecho de que el canal norte quedó demasiado poco profundo.",
      "El personal ofreció otra orientación con el fin de explicar la nueva pregunta de reflexión.",
      "La coordinación añadió un turno debido al hecho de que el comedor cerraba más tarde los sábados.",
    ],
    repetition: [
      "Registros locales de asistencia guiaron el horario inicial, y registros locales de asistencia guiaron la recomendación final del programa.",
      "Práctica enfocada del catálogo mejoró la búsqueda inicial, y práctica enfocada del catálogo mejoró la revisión final de fuentes.",
      "Conteos matutinos de bicicletas informaron el mapa de rutas, y conteos matutinos de bicicletas informaron la discusión sobre seguridad.",
      "Humedad medida del suelo orientó el calendario de riego, y humedad medida del suelo orientó la interpretación del crecimiento.",
      "Memorias grabadas del barrio apoyaron el diseño de la exposición, y memorias grabadas del barrio apoyaron la descripción del catálogo.",
      "Muestras costeras de agua organizaron la tabla del laboratorio, y muestras costeras de agua organizaron la discusión estacional.",
      "Registros semanales de mentoría informaron la revisión formativa, y registros semanales de mentoría informaron la evaluación final del programa.",
      "Residuos medidos del comedor orientaron la campaña educativa, y residuos medidos del comedor orientaron la recomendación sobre porciones.",
    ],
    repetitionMatch: [
      "registros locales de asistencia guiaron",
      "práctica enfocada del catálogo mejoró",
      "conteos matutinos de bicicletas informaron",
      "humedad medida del suelo orientó",
      "memorias grabadas del barrio apoyaron",
      "muestras costeras de agua organizaron",
      "registros semanales de mentoría informaron",
      "residuos medidos del comedor orientaron",
    ],
    voice: [
      "Cabe señalar que las secciones nocturnas perdieron menos participantes después de enviar recordatorios.",
      "Huelga decir que el último grupo completó más búsquedas durante el tiempo asignado.",
      "Cabe señalar que la intersección del río recibió el mayor volumen de bicicletas por la mañana.",
      "Huelga decir que la bandeja cercana a la ventilación produjo los tallos más cortos.",
      "Cabe señalar que tres entrevistas describieron el mismo mercado antes de la renovación.",
      "Huelga decir que la estación norte presentó el intervalo más amplio de salinidad.",
      "Cabe señalar que las preguntas de planificación aparecieron con mayor frecuencia antes de los exámenes.",
      "Huelga decir que la residencia con educación temprana registró el menor total del fin de semana.",
    ],
  },
} as const;

function weakFixture(language: DocLocale, index: number): CoachCorpusFixture {
  const paragraphs = WEAK_PARAGRAPHS[language];
  const odd = index % 2 === 1;
  const phrases = {
    specificity: paragraphs.specificity[index]!,
    specificityMatch: language === "en"
      ? odd ? "Various aspects" : "in many ways"
      : odd
      ? "En diversos sentidos"
      : "de alguna manera",
    evidence: paragraphs.evidence[index]!,
    evidenceMatch: language === "en"
      ? odd || index === 5 || index === 7
        ? "Research clearly shows"
        : "clearly proves that"
      : odd || index === 5 || index === 7
      ? "Los datos confirman que"
      : "demuestra claramente que",
    clarity: paragraphs.clarity[index]!,
    economy: paragraphs.economy[index]!,
    economyMatch: language === "en"
      ? odd ? "due to the fact that" : "in order to"
      : odd
      ? "debido al hecho de que"
      : "con el fin de",
    repetition: paragraphs.repetition[index]!,
    repetitionMatch: paragraphs.repetitionMatch[index]!,
    voice: paragraphs.voice[index]!,
    voiceMatch: language === "en"
      ? odd ? "Needless to say" : "It is important to note that"
      : odd
      ? "Huelga decir que"
      : "Cabe señalar que",
  };
  const parts = [
    phrases.specificity,
    phrases.evidence,
    phrases.clarity,
    phrases.economy,
    phrases.repetition,
    phrases.voice,
  ];
  const text = parts.join("\n\n");
  const observations: Array<[CoachCategory, string, boolean?]> = [
    ["specificity", phrases.specificityMatch],
    ["evidence", phrases.evidenceMatch],
    ["clarity", parts[2]!],
    ["economy", phrases.economyMatch],
    ["repetition", phrases.repetitionMatch, true],
    ["voice", phrases.voiceMatch],
  ];
  return {
    id: `${language}-weak-${String(index + 1).padStart(2, "0")}`,
    documentLanguage: language,
    cohort: "weak",
    text,
    origin: "tesina-lt03-synthetic-v1",
    license: "MIT",
    sourceUrl: null,
    attribution: "Tesina contributors",
    deIdentified: true,
    expectedClean: false,
    proposedObservations: observations.map(([category, observed, last]) => {
      const from = last
        ? text.toLocaleLowerCase(language).lastIndexOf(observed)
        : text.indexOf(observed);
      return {
        id: `${language}-${category}-${index + 1}`,
        category,
        from,
        to: from + observed.length,
      };
    }),
  };
}

const CLEAN_PASSAGES: Record<
  DocLocale,
  Record<Exclude<CorpusCohort, "weak">, readonly string[]>
> = {
  en: {
    competent: [
      "The ecology class compared soil moisture at two garden plots. A table reports the median reading for each site and identifies the collection dates.",
      "Researchers coded twelve council minutes for references to public transit. The results distinguish proposed routes from approved construction projects.",
      "The laboratory weighed each ceramic sample before and after firing. The discussion connects the recorded mass change to the stated procedure.",
      "A campus survey asked commuters to record one usual travel mode. The analysis reports response counts and notes the limits of voluntary participation.",
      "The archive catalog lists the publication date for every newspaper issue. Researchers used those dates to define the study period before coding articles.",
      "Observers measured shade at three playgrounds during the same afternoon interval. The comparison separates tree cover from shade produced by buildings.",
      "The music program recorded rehearsal attendance for one semester. Its summary presents weekly totals without extending the result beyond the enrolled group.",
      "Students tested two water filters with equal sample volumes. The report identifies the measurement instrument and presents the readings in collection order.",
    ],
    "ai-assisted": [
      "The planning memo compares two room layouts using the same accessibility checklist. It reports the observed turning space beside each entrance.",
      "A reading summary groups the article's findings by research question. Each paragraph identifies the table or section that supports its description.",
      "The draft describes temperature changes across four monitoring stations. It keeps the recorded values separate from the author's interpretation.",
      "The methods overview lists recruitment, consent, and coding as separate stages. Dates in the project log establish when each stage occurred.",
      "A source comparison identifies where two reports use different population definitions. The conclusion limits its claim to that documented difference.",
      "The revision note explains why one chart was removed from the results section. It points to the missing observations in the underlying data table.",
      "The literature map places six studies into three methodological groups. Short annotations state the sample and measure used by each study.",
      "A discussion draft compares the pilot outcome with its predefined benchmark. It states the numerical difference before considering possible explanations.",
    ],
    "second-language": [
      "The field team visited each market on the same weekday. They recorded stall counts and opening hours on a shared observation form.",
      "This report examines how three classes used the digital archive. The results present the number of searches completed during each session.",
      "The author describes the interview procedure before presenting participant themes. This order helps readers connect the findings to the collected material.",
      "The experiment used identical containers for both seed groups. Growth measurements were taken every morning for fourteen days.",
      "The community map marks every fountain observed along the selected route. Notes beside each point describe access and operating condition.",
      "The analysis compares the two translations at the sentence level. It identifies differences in technical terms without judging either translator.",
      "The survey included one question about access to study space. The report gives the response totals and explains how missing answers were handled.",
      "The project team photographed the shoreline from fixed locations. Captions record the date, tide level, and direction of every image.",
    ],
  },
  es: {
    competent: [
      "La clase de ecología comparó la humedad del suelo en dos huertos. Una tabla presenta la mediana de cada lugar y las fechas de recolección.",
      "El equipo codificó doce actas municipales sobre transporte público. Los resultados separan las rutas propuestas de los proyectos ya aprobados.",
      "El laboratorio pesó cada muestra de cerámica antes y después de la cocción. La discusión relaciona el cambio registrado con el procedimiento descrito.",
      "Una encuesta universitaria preguntó por el medio habitual de transporte. El análisis presenta los conteos y reconoce los límites de la participación voluntaria.",
      "El catálogo del archivo indica la fecha de cada periódico. Esas fechas definieron el periodo del estudio antes de comenzar la codificación.",
      "El personal observó la sombra en tres parques durante el mismo horario. La comparación distingue los árboles de la sombra producida por edificios.",
      "El programa de música registró la asistencia durante un semestre. El resumen presenta totales semanales limitados al grupo matriculado.",
      "El estudiantado probó dos filtros con volúmenes iguales de agua. El informe identifica el instrumento y presenta las lecturas en orden de recolección.",
    ],
    "ai-assisted": [
      "El memorando compara dos distribuciones de una sala con la misma lista de accesibilidad. Presenta el espacio observado junto a cada entrada.",
      "Un resumen organiza los hallazgos del artículo según sus preguntas de investigación. Cada párrafo identifica la tabla que apoya la descripción.",
      "El borrador describe cambios de temperatura en cuatro estaciones. Mantiene separados los valores registrados y la interpretación posterior.",
      "La síntesis del método enumera reclutamiento, consentimiento y codificación como etapas distintas. El registro establece las fechas de cada etapa.",
      "Una comparación señala dónde dos informes definen de modo diferente su población. La conclusión limita su alcance a esa diferencia documentada.",
      "La nota de revisión explica por qué se retiró una gráfica de los resultados. También identifica las observaciones ausentes en la tabla original.",
      "El mapa bibliográfico agrupa seis estudios según tres métodos. Las anotaciones indican la muestra y la medida utilizada en cada investigación.",
      "La discusión compara el resultado piloto con un criterio definido previamente. Primero presenta la diferencia numérica y luego considera posibles explicaciones.",
    ],
    "second-language": [
      "El equipo de campo visitó cada mercado el mismo día de la semana. Registró la cantidad de puestos y sus horarios en un formulario común.",
      "Este informe examina el uso del archivo digital en tres cursos. Los resultados presentan cuántas búsquedas se completaron en cada sesión.",
      "La autora describe el proceso de entrevistas antes de presentar los temas. Ese orden permite relacionar los hallazgos con el material recopilado.",
      "El experimento utilizó recipientes iguales para los dos grupos de semillas. El crecimiento fue medido cada mañana durante catorce días.",
      "El mapa comunitario marca cada fuente encontrada en la ruta seleccionada. Las notas describen el acceso y el estado de funcionamiento.",
      "El análisis compara las dos traducciones oración por oración. Identifica diferencias terminológicas sin evaluar a las personas traductoras.",
      "La encuesta incluyó una pregunta sobre el acceso a espacios de estudio. El informe presenta los totales y explica el manejo de respuestas ausentes.",
      "El grupo fotografió la costa desde lugares fijos. Cada pie de imagen registra la fecha, la marea y la dirección de la cámara.",
    ],
  },
};

function cleanFixture(
  language: DocLocale,
  cohort: Exclude<CorpusCohort, "weak">,
  index: number,
): CoachCorpusFixture {
  return {
    id: `${language}-${cohort}-${String(index + 1).padStart(2, "0")}`,
    documentLanguage: language,
    cohort,
    text: CLEAN_PASSAGES[language][cohort][index]!,
    origin: "tesina-lt03-synthetic-v1",
    license: "MIT",
    sourceUrl: null,
    attribution: "Tesina contributors",
    deIdentified: true,
    expectedClean: true,
    proposedObservations: [],
  };
}

export const COACH_CORPUS: CoachCorpusFixture[] = (["en", "es"] as const)
  .flatMap((language) => [
    ...Array.from({ length: 8 }, (_, index) => weakFixture(language, index)),
    ...(["competent", "ai-assisted", "second-language"] as const).flatMap((
      cohort,
    ) =>
      Array.from(
        { length: 8 },
        (_, index) => cleanFixture(language, cohort, index),
      )
    ),
  ]);

const EXPLANATIONS: Record<DocLocale, Record<CoachCategory, string>> = {
  en: {
    specificity:
      "This wording is broad and may benefit from a concrete detail.",
    evidence: "This assertion may need nearby support or explanation.",
    clarity: "This sentence combines many words and clause turns.",
    economy: "This phrase uses more words than the idea may require.",
    repetition: "This wording repeats within the same local passage.",
    voice: "This framing delays the passage's concrete point.",
  },
  es: {
    specificity:
      "Esta expresión es amplia y puede beneficiarse de un detalle concreto.",
    evidence: "Esta afirmación puede necesitar apoyo o explicación cercana.",
    clarity: "Esta oración combina muchas palabras y giros de cláusula.",
    economy: "Esta frase usa más palabras de las que puede requerir la idea.",
    repetition: "Esta formulación se repite dentro del mismo pasaje local.",
    voice: "Este marco retrasa el punto concreto del pasaje.",
  },
};
const QUESTIONS: Record<DocLocale, Record<CoachCategory, string>> = {
  en: {
    specificity: "Which concrete detail would make this wording more precise?",
    evidence:
      "What nearby support or explanation would help the reader assess this assertion?",
    clarity:
      "How could you divide or reorder this sentence while preserving its meaning?",
    economy: "Which shorter phrasing would preserve the exact meaning?",
    repetition:
      "Could one occurrence be varied or removed without losing emphasis?",
    voice: "Could the sentence begin with its concrete point?",
  },
  es: {
    specificity: "¿Qué detalle concreto haría más precisa esta expresión?",
    evidence:
      "¿Qué apoyo o explicación cercana ayudaría a evaluar esta afirmación?",
    clarity:
      "¿Cómo podrías dividir u ordenar esta oración sin cambiar su significado?",
    economy: "¿Qué formulación más breve conservaría el significado exacto?",
    repetition:
      "¿Podrías variar o quitar una repetición sin perder el énfasis?",
    voice: "¿Podría la oración comenzar con su punto concreto?",
  },
};

export function renderCoachMessage(
  descriptor: CoachMessageDescriptor,
  uiLocale: DocLocale,
): string {
  const category = descriptor.id.split(".")[1] as CoachCategory;
  return descriptor.id.endsWith(".question")
    ? QUESTIONS[uiLocale][category]
    : EXPLANATIONS[uiLocale][category];
}
