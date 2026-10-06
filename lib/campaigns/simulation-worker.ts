import type {
  SupabaseClient,
} from "@supabase/supabase-js";

// =====================================================
// TIPOS
// =====================================================

type WorkerSchedule = {
  windowStart: string;
  windowEnd: string;

  maxPerHour: number;
  maxPerDay: number;

  allowedWeekdays: number[];
};

type CampaignRow = {
  id: string;

  organization_id: string;

  status: string;

  execution_mode: string;

  schedule_config: unknown;

  next_run_at:
    string | null;
};

export type SimulationWorkerResult = {
  campaignId: string;

  processed: number;

  remaining: number;

  completed: boolean;

  nextRunAt:
    string | null;

  message: string;
};

// =====================================================
// CONFIG
// =====================================================

const MAX_BATCH_SIZE =
  10;

const ARGENTINA_OFFSET_MINUTES =
  -180;

// =====================================================
// PROCESS CAMPAIGN
// =====================================================

export async function processSimulationCampaign({
  supabase,
  campaignId,
  organizationId,
}: {
  supabase:
    SupabaseClient;

  campaignId:
    string;

  organizationId?:
    string;
}): Promise<
  SimulationWorkerResult
> {
  // ===================================================
  // CAMPAIGN
  // ===================================================

  let campaignQuery =
    supabase
      .from(
        "campaigns"
      )
      .select(
        `
          id,
          organization_id,
          status,
          execution_mode,
          schedule_config,
          next_run_at
        `
      )
      .eq(
        "id",
        campaignId
      );

  if (
    organizationId
  ) {
    campaignQuery =
      campaignQuery.eq(
        "organization_id",
        organizationId
      );
  }

  const {
    data:
      campaignData,

    error:
      campaignError,
  } =
    await campaignQuery
      .maybeSingle();

  if (
    campaignError ||
    !campaignData
  ) {
    throw new Error(
      "No encontramos la campaña."
    );
  }

  const campaign =
    campaignData as CampaignRow;

  // ===================================================
  // STATUS
  // ===================================================

  if (
    campaign.status !==
    "running"
  ) {
    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        campaign.next_run_at,

      message:
        "La campaña no está en curso.",
    };
  }

  // ===================================================
  // SIMULATION ONLY
  // ===================================================

  if (
    campaign.execution_mode !==
    "simulation"
  ) {
    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        campaign.next_run_at,

      message:
        "La campaña no está en modo simulación.",
    };
  }

  const schedule =
    parseScheduleConfig(
      campaign.schedule_config
    );

  const now =
    new Date();

  // ===================================================
  // WINDOW
  // ===================================================

  if (
    !isInsideScheduleWindow(
      now,
      schedule
    )
  ) {
    const nextAllowed =
      findNextAllowedWindow(
        now,
        schedule
      );

    await updateCampaignTiming(
      supabase,
      campaign.id,
      campaign.organization_id,
      {
        nextRunAt:
          nextAllowed.toISOString(),

        lastRunAt:
          now.toISOString(),
      }
    );

    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        nextAllowed.toISOString(),

      message:
        "Campaña fuera de la franja horaria. Quedó programada para el próximo período permitido.",
    };
  }

  // ===================================================
  // LAST HOUR
  // ===================================================

  const hourAgo =
    new Date(
      now.getTime() -
        60 *
          60 *
          1000
    );

  const {
    count:
      processedLastHour,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      "id",
      {
        count:
          "exact",

        head:
          true,
      }
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "simulated"
    )
    .gte(
      "simulated_at",
      hourAgo.toISOString()
    );

  // ===================================================
  // TODAY
  // ===================================================

  const startToday =
    getArgentinaDayStartUtc(
      now
    );

  const {
    count:
      processedToday,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      "id",
      {
        count:
          "exact",

        head:
          true,
      }
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "simulated"
    )
    .gte(
      "simulated_at",
      startToday.toISOString()
    );

  const availableHour =
    Math.max(
      0,
      schedule.maxPerHour -
        (processedLastHour ??
          0)
    );

  const availableDay =
    Math.max(
      0,
      schedule.maxPerDay -
        (processedToday ??
          0)
    );

  const batchLimit =
    Math.min(
      MAX_BATCH_SIZE,
      availableHour,
      availableDay
    );

  // ===================================================
  // HOUR LIMIT
  // ===================================================

  if (
    availableHour <= 0
  ) {
    const nextRun =
      await calculateNextHourlyAvailability(
        supabase,
        campaignId,
        now,
        schedule
      );

    await updateCampaignTiming(
      supabase,
      campaign.id,
      campaign.organization_id,
      {
        nextRunAt:
          nextRun.toISOString(),

        lastRunAt:
          now.toISOString(),
      }
    );

    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        nextRun.toISOString(),

      message:
        "Se alcanzó el máximo configurado para la última hora.",
    };
  }

  // ===================================================
  // DAILY LIMIT
  // ===================================================

  if (
    availableDay <= 0
  ) {
    const nextRun =
      findNextAllowedDayStart(
        now,
        schedule
      );

    await updateCampaignTiming(
      supabase,
      campaign.id,
      campaign.organization_id,
      {
        nextRunAt:
          nextRun.toISOString(),

        lastRunAt:
          now.toISOString(),
      }
    );

    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        nextRun.toISOString(),

      message:
        "Se alcanzó el máximo diario. La campaña continuará en el próximo período permitido.",
    };
  }

  if (
    batchLimit <= 0
  ) {
    return {
      campaignId,

      processed: 0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed: false,

      nextRunAt:
        campaign.next_run_at,

      message:
        "No hay capacidad disponible para procesar el lote.",
    };
  }

  // ===================================================
  // DUE RECIPIENTS
  // ===================================================

  const {
    data:
      dueRecipients,

    error:
      dueError,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      `
        id,
        attempt_count,
        scheduled_for
      `
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "prepared"
    )
    .lte(
      "scheduled_for",
      now.toISOString()
    )
    .order(
      "scheduled_for",
      {
        ascending:
          true,
      }
    )
    .limit(
      batchLimit
    );

  if (dueError) {
    throw new Error(
      "No se pudo leer la cola de destinatarios."
    );
  }

  // ===================================================
  // NO DUE RECIPIENTS
  // ===================================================

  if (
    !dueRecipients ||
    dueRecipients.length ===
      0
  ) {
    return await handleNoDueRecipients(
      supabase,
      campaign,
      schedule,
      now
    );
  }

  // ===================================================
  // PROCESS
  // ===================================================

  let processed =
    0;

  for (
    const recipient of
    dueRecipients
  ) {
    const processedAt =
      new Date().toISOString();

    /*
     * El WHERE status=prepared
     * evita que el mismo registro
     * sea procesado dos veces si
     * coinciden dos ejecuciones.
     */

    const {
      data:
        updated,

      error:
        updateError,
    } = await supabase
      .from(
        "campaign_recipients"
      )
      .update({
        status:
          "simulated",

        simulated_at:
          processedAt,

        last_attempt_at:
          processedAt,

        attempt_count:
          Number(
            recipient.attempt_count ??
            0
          ) + 1,

        external_message_id:
          `simulation:${crypto.randomUUID()}`,
      })
      .eq(
        "id",
        recipient.id
      )
      .eq(
        "campaign_id",
        campaignId
      )
      .eq(
        "status",
        "prepared"
      )
      .select(
        "id"
      )
      .maybeSingle();

    if (updateError) {
      console.error(
        "Error procesando destinatario:",
        updateError
      );

      continue;
    }

    if (updated) {
      processed +=
        1;
    }
  }

  // ===================================================
  // REMAINING
  // ===================================================

  const remaining =
    await countPrepared(
      supabase,
      campaignId
    );

  if (
    remaining === 0
  ) {
    await supabase
      .from(
        "campaigns"
      )
      .update({
        status:
          "completed",

        next_run_at:
          null,

        last_run_at:
          now.toISOString(),
      })
      .eq(
        "id",
        campaignId
      )
      .eq(
        "organization_id",
        campaign.organization_id
      );

    return {
      campaignId,

      processed,

      remaining: 0,

      completed: true,

      nextRunAt:
        null,

      message:
        `Simulación completada. Se procesaron ${processed} destinatarios en esta ejecución.`,
    };
  }

  // ===================================================
  // NEXT RECIPIENT
  // ===================================================

  const nextScheduled =
    await getNextPreparedSchedule(
      supabase,
      campaignId
    );

  const nextRun =
    nextScheduled
      ? getEffectiveNextRun(
          new Date(
            nextScheduled
          ),
          now,
          schedule
        )
      : findNextAllowedWindow(
          now,
          schedule
        );

  await updateCampaignTiming(
    supabase,
    campaign.id,
    campaign.organization_id,
    {
      nextRunAt:
        nextRun.toISOString(),

      lastRunAt:
        now.toISOString(),
    }
  );

  return {
    campaignId,

    processed,

    remaining,

    completed: false,

    nextRunAt:
      nextRun.toISOString(),

    message:
      `Se simularon ${processed} destinatarios. Quedan ${remaining} pendientes.`,
  };
}

// =====================================================
// NO DUE
// =====================================================

async function handleNoDueRecipients(
  supabase:
    SupabaseClient,

  campaign:
    CampaignRow,

  schedule:
    WorkerSchedule,

  now:
    Date
): Promise<
  SimulationWorkerResult
> {
  const remaining =
    await countPrepared(
      supabase,
      campaign.id
    );

  if (
    remaining === 0
  ) {
    await supabase
      .from(
        "campaigns"
      )
      .update({
        status:
          "completed",

        next_run_at:
          null,

        last_run_at:
          now.toISOString(),
      })
      .eq(
        "id",
        campaign.id
      )
      .eq(
        "organization_id",
        campaign.organization_id
      );

    return {
      campaignId:
        campaign.id,

      processed: 0,

      remaining: 0,

      completed: true,

      nextRunAt:
        null,

      message:
        "La campaña ya está completamente procesada.",
    };
  }

  const nextScheduled =
    await getNextPreparedSchedule(
      supabase,
      campaign.id
    );

  const nextRun =
    nextScheduled
      ? getEffectiveNextRun(
          new Date(
            nextScheduled
          ),
          now,
          schedule
        )
      : findNextAllowedWindow(
          now,
          schedule
        );

  await updateCampaignTiming(
    supabase,
    campaign.id,
    campaign.organization_id,
    {
      nextRunAt:
        nextRun.toISOString(),

      lastRunAt:
        now.toISOString(),
    }
  );

  return {
    campaignId:
      campaign.id,

    processed: 0,

    remaining,

    completed: false,

    nextRunAt:
      nextRun.toISOString(),

    message:
      "Todavía no llegó el horario del próximo destinatario.",
  };
}

// =====================================================
// COUNT
// =====================================================

async function countPrepared(
  supabase:
    SupabaseClient,

  campaignId:
    string
) {
  const {
    count,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      "id",
      {
        count:
          "exact",

        head:
          true,
      }
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "prepared"
    );

  return count ??
    0;
}

// =====================================================
// NEXT RECIPIENT
// =====================================================

async function getNextPreparedSchedule(
  supabase:
    SupabaseClient,

  campaignId:
    string
) {
  const {
    data,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      "scheduled_for"
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "prepared"
    )
    .order(
      "scheduled_for",
      {
        ascending:
          true,
      }
    )
    .limit(1)
    .maybeSingle();

  return data?.scheduled_for ??
    null;
}

// =====================================================
// UPDATE CAMPAIGN TIMING
// =====================================================

async function updateCampaignTiming(
  supabase:
    SupabaseClient,

  campaignId:
    string,

  organizationId:
    string,

  {
    nextRunAt,
    lastRunAt,
  }: {
    nextRunAt:
      string | null;

    lastRunAt:
      string;
  }
) {
  await supabase
    .from(
      "campaigns"
    )
    .update({
      next_run_at:
        nextRunAt,

      last_run_at:
        lastRunAt,
    })
    .eq(
      "id",
      campaignId
    )
    .eq(
      "organization_id",
      organizationId
    );
}

// =====================================================
// HOUR AVAILABILITY
// =====================================================

async function calculateNextHourlyAvailability(
  supabase:
    SupabaseClient,

  campaignId:
    string,

  now:
    Date,

  schedule:
    WorkerSchedule
) {
  const hourAgo =
    new Date(
      now.getTime() -
        60 *
          60 *
          1000
    );

  const {
    data,
  } = await supabase
    .from(
      "campaign_recipients"
    )
    .select(
      "simulated_at"
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "simulated"
    )
    .gte(
      "simulated_at",
      hourAgo.toISOString()
    )
    .order(
      "simulated_at",
      {
        ascending:
          true,
      }
    )
    .limit(1)
    .maybeSingle();

  if (
    !data?.simulated_at
  ) {
    return new Date(
      now.getTime() +
        5 *
          60 *
          1000
    );
  }

  const calculated =
    new Date(
      new Date(
        data.simulated_at
      ).getTime() +
        60 *
          60 *
          1000 +
        1000
    );

  return getEffectiveNextRun(
    calculated,
    now,
    schedule
  );
}

// =====================================================
// NEXT EFFECTIVE RUN
// =====================================================

function getEffectiveNextRun(
  candidateDate:
    Date,

  now:
    Date,

  schedule:
    WorkerSchedule
) {
  let candidate =
    new Date(
      Math.max(
        candidateDate.getTime(),
        now.getTime()
      )
    );

  if (
    isInsideScheduleWindow(
      candidate,
      schedule
    )
  ) {
    return candidate;
  }

  return findNextAllowedWindow(
    candidate,
    schedule
  );
}

// =====================================================
// SCHEDULE CONFIG
// =====================================================

function parseScheduleConfig(
  value:
    unknown
): WorkerSchedule {
  const fallback:
    WorkerSchedule = {
    windowStart:
      "09:00",

    windowEnd:
      "20:00",

    maxPerHour:
      20,

    maxPerDay:
      60,

    allowedWeekdays: [
      1,
      2,
      3,
      4,
      5,
      6,
    ],
  };

  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value
    )
  ) {
    return fallback;
  }

  const config =
    value as Record<
      string,
      unknown
    >;

  const weekdays =
    Array.isArray(
      config.allowedWeekdays
    )
      ? config.allowedWeekdays
          .map(
            (
              value
            ) =>
              Number(
                value
              )
          )
          .filter(
            (
              value
            ) =>
              Number.isInteger(
                value
              ) &&
              value >= 1 &&
              value <= 7
          )
      : fallback.allowedWeekdays;

  return {
    windowStart:
      typeof config.windowStart ===
      "string"
        ? config.windowStart
        : fallback.windowStart,

    windowEnd:
      typeof config.windowEnd ===
      "string"
        ? config.windowEnd
        : fallback.windowEnd,

    maxPerHour:
      Math.max(
        1,
        Math.floor(
          Number(
            config.maxPerHour ??
            fallback.maxPerHour
          )
        )
      ),

    maxPerDay:
      Math.max(
        1,
        Math.floor(
          Number(
            config.maxPerDay ??
            fallback.maxPerDay
          )
        )
      ),

    allowedWeekdays:
      weekdays.length >
      0
        ? weekdays
        : fallback.allowedWeekdays,
  };
}

// =====================================================
// INSIDE WINDOW
// =====================================================

function isInsideScheduleWindow(
  date:
    Date,

  schedule:
    WorkerSchedule
) {
  const local =
    getArgentinaLocalParts(
      date
    );

  const weekday =
    isoWeekday(
      local.year,
      local.month,
      local.day
    );

  if (
    !schedule.allowedWeekdays.includes(
      weekday
    )
  ) {
    return false;
  }

  const start =
    parseTimeToMinutes(
      schedule.windowStart
    );

  const end =
    parseTimeToMinutes(
      schedule.windowEnd
    );

  if (
    start === null ||
    end === null
  ) {
    return false;
  }

  const current =
    local.hour *
      60 +
    local.minute;

  return (
    current >=
      start &&
    current <=
      end
  );
}

// =====================================================
// NEXT WINDOW
// =====================================================

function findNextAllowedWindow(
  date:
    Date,

  schedule:
    WorkerSchedule
) {
  const startMinutes =
    parseTimeToMinutes(
      schedule.windowStart
    );

  if (
    startMinutes ===
    null
  ) {
    throw new Error(
      "Horario inicial inválido."
    );
  }

  let candidate =
    new Date(date);

  for (
    let iteration = 0;
    iteration < 14;
    iteration += 1
  ) {
    const local =
      getArgentinaLocalParts(
        candidate
      );

    const weekday =
      isoWeekday(
        local.year,
        local.month,
        local.day
      );

    const currentMinutes =
      local.hour *
        60 +
      local.minute;

    if (
      schedule.allowedWeekdays.includes(
        weekday
      )
    ) {
      if (
        currentMinutes <
        startMinutes
      ) {
        return argentinaLocalToUtc(
          local.year,
          local.month,
          local.day,
          Math.floor(
            startMinutes /
            60
          ),
          startMinutes %
            60
        );
      }

      if (
        isInsideScheduleWindow(
          candidate,
          schedule
        )
      ) {
        return candidate;
      }
    }

    candidate =
      nextArgentinaDayAt(
        candidate,
        startMinutes
      );
  }

  throw new Error(
    "No se encontró un próximo período permitido."
  );
}

// =====================================================
// NEXT DAY START
// =====================================================

function findNextAllowedDayStart(
  now:
    Date,

  schedule:
    WorkerSchedule
) {
  const startMinutes =
    parseTimeToMinutes(
      schedule.windowStart
    );

  if (
    startMinutes ===
    null
  ) {
    throw new Error(
      "Horario inicial inválido."
    );
  }

  let candidate =
    nextArgentinaDayAt(
      now,
      startMinutes
    );

  for (
    let iteration = 0;
    iteration < 14;
    iteration += 1
  ) {
    const local =
      getArgentinaLocalParts(
        candidate
      );

    const weekday =
      isoWeekday(
        local.year,
        local.month,
        local.day
      );

    if (
      schedule.allowedWeekdays.includes(
        weekday
      )
    ) {
      return candidate;
    }

    candidate =
      nextArgentinaDayAt(
        candidate,
        startMinutes
      );
  }

  throw new Error(
    "No se encontró un próximo día permitido."
  );
}

// =====================================================
// ARGENTINA LOCAL
// =====================================================

function getArgentinaLocalParts(
  date:
    Date
) {
  const local =
    new Date(
      date.getTime() +
        ARGENTINA_OFFSET_MINUTES *
          60 *
          1000
    );

  return {
    year:
      local.getUTCFullYear(),

    month:
      local.getUTCMonth() +
      1,

    day:
      local.getUTCDate(),

    hour:
      local.getUTCHours(),

    minute:
      local.getUTCMinutes(),
  };
}

// =====================================================
// LOCAL TO UTC
// =====================================================

function argentinaLocalToUtc(
  year:
    number,

  month:
    number,

  day:
    number,

  hour:
    number,

  minute:
    number
) {
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour + 3,
      minute,
      0,
      0
    )
  );
}

// =====================================================
// NEXT DAY
// =====================================================

function nextArgentinaDayAt(
  date:
    Date,

  minutes:
    number
) {
  const local =
    getArgentinaLocalParts(
      date
    );

  const pseudoDate =
    new Date(
      Date.UTC(
        local.year,
        local.month -
          1,
        local.day +
          1
      )
    );

  return argentinaLocalToUtc(
    pseudoDate.getUTCFullYear(),
    pseudoDate.getUTCMonth() +
      1,
    pseudoDate.getUTCDate(),
    Math.floor(
      minutes /
      60
    ),
    minutes %
      60
  );
}

// =====================================================
// START LOCAL DAY
// =====================================================

function getArgentinaDayStartUtc(
  date:
    Date
) {
  const local =
    getArgentinaLocalParts(
      date
    );

  return argentinaLocalToUtc(
    local.year,
    local.month,
    local.day,
    0,
    0
  );
}

// =====================================================
// WEEKDAY
// =====================================================

function isoWeekday(
  year:
    number,

  month:
    number,

  day:
    number
) {
  const weekday =
    new Date(
      Date.UTC(
        year,
        month -
          1,
        day
      )
    ).getUTCDay();

  return weekday ===
    0
    ? 7
    : weekday;
}

// =====================================================
// TIME
// =====================================================

function parseTimeToMinutes(
  value:
    string
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
    hour *
      60 +
    minute
  );
}