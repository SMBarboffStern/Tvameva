// =====================================================
// TVAMEVA - CAMPAIGN ENGINE
// =====================================================

export type GreetingMode =
  | "automatic"
  | "varied"
  | "fixed";

export type CampaignGreetingConfig = {
  mode: GreetingMode;

  fixed: string;

  variants: string[];
};

export type CampaignScheduleConfig = {
  timezone: string;

  startAt: string;

  windowStart: string;
  windowEnd: string;

  maxPerHour: number;
  maxPerDay: number;

  continueNextDay: boolean;

  /*
   * ISO weekday:
   * 1 = lunes
   * ...
   * 7 = domingo
   */
  allowedWeekdays: number[];
};

export type CampaignContact = {
  id: string;

  firstName: string;
  lastName: string;

  phone: string;

  email: string;

  sourceData: unknown;

  optedIn?: boolean;
};

export type BuiltCampaignRecipient = {
  contactId: string;

  firstName: string;
  lastName: string;

  fullName: string;

  phone: string;

  email: string;

  greeting: string;

  message: string;

  scheduledFor: string;

  optedIn: boolean;
};

type BuildRecipientsInput = {
  contacts: CampaignContact[];

  templateBody: string;

  greetingConfig:
    CampaignGreetingConfig;

  scheduleConfig:
    CampaignScheduleConfig;

  branchName: string;
};

// =====================================================
// CONFIGURACIÓN
// =====================================================

const ARGENTINA_OFFSET_MINUTES =
  -180;

const MAX_SCHEDULE_DAYS =
  370;

// =====================================================
// SALUDOS AUTOMÁTICOS
// =====================================================

const MORNING_GREETINGS = [
  "Buenos días {{nombre}}, ¿cómo estás?",
  "Buen día {{nombre}}, ¿cómo va?",
  "¡Muy buenos días, {{nombre}}!",
];

const AFTERNOON_GREETINGS = [
  "Buenas tardes {{nombre}}, ¿cómo estás?",
  "Hola {{nombre}}, ¿cómo va tu tarde?",
  "Muy buenas tardes {{nombre}}.",
];

const EVENING_GREETINGS = [
  "Hola {{nombre}}, ¿cómo estás?",
  "Buenas noches {{nombre}}, espero que estés muy bien.",
  "Hola {{nombre}}, ¿cómo va?",
];

// =====================================================
// CONSTRUIR DESTINATARIOS
// =====================================================

export function buildCampaignRecipients({
  contacts,
  templateBody,
  greetingConfig,
  scheduleConfig,
  branchName,
}: BuildRecipientsInput):
  BuiltCampaignRecipient[] {
  validateCampaignSchedule(
    scheduleConfig
  );

  if (!templateBody.trim()) {
    throw new Error(
      "La plantilla no contiene un mensaje."
    );
  }

  if (
    contacts.length === 0
  ) {
    throw new Error(
      "No seleccionaste destinatarios."
    );
  }

  const sortedContacts =
    [...contacts].sort(
      compareContacts
    );

  const intervalMinutes =
    60 /
    scheduleConfig.maxPerHour;

  const intervalMilliseconds =
    intervalMinutes *
    60 *
    1000;

  let cursor =
    new Date(
      scheduleConfig.startAt
    );

  if (
    Number.isNaN(
      cursor.getTime()
    )
  ) {
    throw new Error(
      "La fecha de inicio de la campaña no es válida."
    );
  }

  const originalLocalDay =
    getLocalDayKey(
      cursor
    );

  const dailyCounts =
    new Map<
      string,
      number
    >();

  const recipients:
    BuiltCampaignRecipient[] =
      [];

  for (
    let index = 0;
    index <
    sortedContacts.length;
    index += 1
  ) {
    const contact =
      sortedContacts[index];

    cursor =
      findNextAvailableSlot(
        cursor,
        scheduleConfig,
        dailyCounts
      );

    const slotDay =
      getLocalDayKey(
        cursor
      );

    if (
      !scheduleConfig.continueNextDay &&
      slotDay !==
        originalLocalDay
    ) {
      throw new Error(
        "La campaña no entra dentro del período seleccionado. Activá “Continuar al día siguiente”, ampliá el horario o aumentá los límites."
      );
    }

    const usedToday =
      dailyCounts.get(
        slotDay
      ) ?? 0;

    dailyCounts.set(
      slotDay,
      usedToday + 1
    );

    const variables =
      buildContactVariables(
        contact,
        branchName
      );

    const greetingTemplate =
      resolveGreetingTemplate(
        greetingConfig,
        cursor,
        index
      );

    const greeting =
      renderVariables(
        greetingTemplate,
        variables
      );

    const message =
      renderVariables(
        templateBody,
        {
          ...variables,
          saludo:
            greeting,
        }
      );

    const fullName =
      [
        contact.firstName,
        contact.lastName,
      ]
        .filter(Boolean)
        .join(" ") ||
      "Sin nombre";

    recipients.push({
      contactId:
        contact.id,

      firstName:
        contact.firstName,

      lastName:
        contact.lastName,

      fullName,

      phone:
        contact.phone,

      email:
        contact.email,

      greeting,

      message,

      scheduledFor:
        cursor.toISOString(),

      optedIn:
        contact.optedIn ===
        true,
    });

    cursor =
      new Date(
        cursor.getTime() +
          intervalMilliseconds
      );
  }

  return recipients;
}

// =====================================================
// VALIDAR PROGRAMACIÓN
// =====================================================

export function validateCampaignSchedule(
  config:
    CampaignScheduleConfig
) {
  if (
    config.timezone !==
    "America/Argentina/Buenos_Aires"
  ) {
    throw new Error(
      "Por ahora Tvameva utiliza la zona horaria America/Argentina/Buenos_Aires."
    );
  }

  const maxPerHour =
    Number(
      config.maxPerHour
    );

  const maxPerDay =
    Number(
      config.maxPerDay
    );

  if (
    !Number.isInteger(
      maxPerHour
    ) ||
    maxPerHour < 1 ||
    maxPerHour > 500
  ) {
    throw new Error(
      "El máximo por hora debe estar entre 1 y 500."
    );
  }

  if (
    !Number.isInteger(
      maxPerDay
    ) ||
    maxPerDay < 1 ||
    maxPerDay > 10000
  ) {
    throw new Error(
      "El máximo diario debe estar entre 1 y 10.000."
    );
  }

  const startMinutes =
    parseTimeToMinutes(
      config.windowStart
    );

  const endMinutes =
    parseTimeToMinutes(
      config.windowEnd
    );

  if (
    startMinutes === null ||
    endMinutes === null
  ) {
    throw new Error(
      "La franja horaria no es válida."
    );
  }

  if (
    startMinutes >=
    endMinutes
  ) {
    throw new Error(
      "La hora final debe ser posterior a la hora inicial."
    );
  }

  if (
    !Array.isArray(
      config.allowedWeekdays
    ) ||
    config.allowedWeekdays
      .length === 0
  ) {
    throw new Error(
      "Seleccioná al menos un día habilitado."
    );
  }

  for (
    const weekday of
    config.allowedWeekdays
  ) {
    if (
      !Number.isInteger(
        weekday
      ) ||
      weekday < 1 ||
      weekday > 7
    ) {
      throw new Error(
        "La configuración de días habilitados no es válida."
      );
    }
  }
}

// =====================================================
// ENCONTRAR PRÓXIMO SLOT
// =====================================================

function findNextAvailableSlot(
  initialDate: Date,
  config:
    CampaignScheduleConfig,
  dailyCounts:
    Map<string, number>
) {
  let candidate =
    new Date(
      initialDate
    );

  const windowStart =
    parseTimeToMinutes(
      config.windowStart
    );

  const windowEnd =
    parseTimeToMinutes(
      config.windowEnd
    );

  if (
    windowStart === null ||
    windowEnd === null
  ) {
    throw new Error(
      "La franja horaria no es válida."
    );
  }

  for (
    let iteration = 0;
    iteration <
    MAX_SCHEDULE_DAYS *
      10;
    iteration += 1
  ) {
    const parts =
      getArgentinaLocalParts(
        candidate
      );

    const weekday =
      isoWeekday(
        parts.year,
        parts.month,
        parts.day
      );

    if (
      !config.allowedWeekdays.includes(
        weekday
      )
    ) {
      candidate =
        nextLocalDayAt(
          candidate,
          windowStart
        );

      continue;
    }

    const localMinutes =
      parts.hour * 60 +
      parts.minute +
      parts.second / 60;

    if (
      localMinutes <
      windowStart
    ) {
      candidate =
        sameLocalDayAt(
          candidate,
          windowStart
        );

      continue;
    }

    if (
      localMinutes >
      windowEnd
    ) {
      candidate =
        nextLocalDayAt(
          candidate,
          windowStart
        );

      continue;
    }

    const dayKey =
      getLocalDayKey(
        candidate
      );

    const dailyCount =
      dailyCounts.get(
        dayKey
      ) ?? 0;

    if (
      dailyCount >=
      config.maxPerDay
    ) {
      candidate =
        nextLocalDayAt(
          candidate,
          windowStart
        );

      continue;
    }

    return candidate;
  }

  throw new Error(
    "No pudimos construir la programación de la campaña."
  );
}

// =====================================================
// VARIABLES DEL CONTACTO
// =====================================================

function buildContactVariables(
  contact:
    CampaignContact,
  branchName: string
) {
  return {
    nombre:
      contact.firstName ||
      "",

    apellido:
      contact.lastName ||
      "",

    curso:
      getMappedText(
        contact.sourceData,
        "course"
      ),

    ciudad:
      getMappedText(
        contact.sourceData,
        "city"
      ),

    sede:
      branchName ||
      "",
  };
}

// =====================================================
// RESOLVER SALUDO
// =====================================================

function resolveGreetingTemplate(
  config:
    CampaignGreetingConfig,
  scheduledFor: Date,
  index: number
) {
  if (
    config.mode === "fixed"
  ) {
    const fixed =
      config.fixed.trim();

    if (!fixed) {
      return "Hola {{nombre}}, ¿cómo estás?";
    }

    return fixed;
  }

  if (
    config.mode ===
    "varied"
  ) {
    const variants =
      config.variants
        .map(
          (value) =>
            value.trim()
        )
        .filter(Boolean);

    if (
      variants.length ===
      0
    ) {
      return "Hola {{nombre}}, ¿cómo estás?";
    }

    return variants[
      index %
        variants.length
    ];
  }

  const parts =
    getArgentinaLocalParts(
      scheduledFor
    );

  let options:
    string[];

  if (
    parts.hour >= 5 &&
    parts.hour < 12
  ) {
    options =
      MORNING_GREETINGS;
  } else if (
    parts.hour >= 12 &&
    parts.hour < 20
  ) {
    options =
      AFTERNOON_GREETINGS;
  } else {
    options =
      EVENING_GREETINGS;
  }

  return options[
    index %
      options.length
  ];
}

// =====================================================
// RENDER VARIABLES
// =====================================================

export function renderVariables(
  template: string,
  variables:
    Record<string, string>
) {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (
      fullMatch,
      key: string
    ) => {
      if (
        Object.prototype.hasOwnProperty.call(
          variables,
          key
        )
      ) {
        return variables[
          key
        ];
      }

      return fullMatch;
    }
  );
}

// =====================================================
// ORDEN DETERMINÍSTICO
// =====================================================

function compareContacts(
  a: CampaignContact,
  b: CampaignContact
) {
  const aName =
    `${a.lastName} ${a.firstName} ${a.id}`
      .toLocaleLowerCase(
        "es-AR"
      );

  const bName =
    `${b.lastName} ${b.firstName} ${b.id}`
      .toLocaleLowerCase(
        "es-AR"
      );

  return aName.localeCompare(
    bName,
    "es-AR"
  );
}

// =====================================================
// SOURCE DATA
// =====================================================

function getMappedText(
  sourceData: unknown,
  key: string
) {
  if (
    !sourceData ||
    typeof sourceData !==
      "object" ||
    Array.isArray(
      sourceData
    )
  ) {
    return "";
  }

  const root =
    sourceData as Record<
      string,
      unknown
    >;

  const mapped =
    root.mapped;

  if (
    !mapped ||
    typeof mapped !==
      "object" ||
    Array.isArray(
      mapped
    )
  ) {
    return "";
  }

  const mappedObject =
    mapped as Record<
      string,
      unknown
    >;

  return String(
    mappedObject[
      key
    ] ?? ""
  ).trim();
}

// =====================================================
// HORAS
// =====================================================

function parseTimeToMinutes(
  value: string
) {
  const match =
    /^(\d{2}):(\d{2})$/.exec(
      value
    );

  if (!match) {
    return null;
  }

  const hour =
    Number(
      match[1]
    );

  const minute =
    Number(
      match[2]
    );

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return (
    hour * 60 +
    minute
  );
}

// =====================================================
// ARGENTINA LOCAL TIME
// =====================================================

function getArgentinaLocalParts(
  date: Date
) {
  const localPseudoUtc =
    new Date(
      date.getTime() +
        ARGENTINA_OFFSET_MINUTES *
          60 *
          1000
    );

  return {
    year:
      localPseudoUtc.getUTCFullYear(),

    month:
      localPseudoUtc.getUTCMonth() +
      1,

    day:
      localPseudoUtc.getUTCDate(),

    hour:
      localPseudoUtc.getUTCHours(),

    minute:
      localPseudoUtc.getUTCMinutes(),

    second:
      localPseudoUtc.getUTCSeconds(),
  };
}

function argentinaLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour -
        ARGENTINA_OFFSET_MINUTES /
          60,
      minute,
      0,
      0
    )
  );
}

// =====================================================
// MISMO DÍA A UNA HORA
// =====================================================

function sameLocalDayAt(
  date: Date,
  minutes: number
) {
  const parts =
    getArgentinaLocalParts(
      date
    );

  const hour =
    Math.floor(
      minutes / 60
    );

  const minute =
    minutes % 60;

  return argentinaLocalToUtc(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute
  );
}

// =====================================================
// PRÓXIMO DÍA
// =====================================================

function nextLocalDayAt(
  date: Date,
  minutes: number
) {
  const parts =
    getArgentinaLocalParts(
      date
    );

  const nextDay =
    new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day + 1
      )
    );

  const hour =
    Math.floor(
      minutes / 60
    );

  const minute =
    minutes % 60;

  return argentinaLocalToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() +
      1,
    nextDay.getUTCDate(),
    hour,
    minute
  );
}

// =====================================================
// DÍA ISO
// =====================================================

function isoWeekday(
  year: number,
  month: number,
  day: number
) {
  const jsDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    ).getUTCDay();

  return jsDay === 0
    ? 7
    : jsDay;
}

// =====================================================
// KEY DEL DÍA
// =====================================================

function getLocalDayKey(
  date: Date
) {
  const parts =
    getArgentinaLocalParts(
      date
    );

  return [
    parts.year,
    String(
      parts.month
    ).padStart(
      2,
      "0"
    ),
    String(
      parts.day
    ).padStart(
      2,
      "0"
    ),
  ].join("-");
}