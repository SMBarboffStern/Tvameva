import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  getMessagingProvider,
} from "@/lib/messaging/provider";

// =====================================================
// TIPOS
// =====================================================

type WorkerSchedule = {
  windowStart:
    string;

  windowEnd:
    string;

  maxPerHour:
    number;

  maxPerDay:
    number;

  allowedWeekdays:
    number[];
};

type CampaignRow = {
  id:
    string;

  organization_id:
    string;

  status:
    string;

  execution_mode:
    "simulation" |
    "live";

  schedule_config:
    unknown;

  next_run_at:
    string | null;
};

type RecipientRow = {
  id:
    string;

  contact_id:
    string;

  rendered_message:
    string;

  attempt_count:
    number;

  scheduled_for:
    string | null;
};

type ContactRow = {
  id:
    string;

  phone_e164:
    string;

  opted_in:
    boolean;

  status:
    string;
};

export type SimulationWorkerResult = {
  campaignId:
    string;

  processed:
    number;

  remaining:
    number;

  completed:
    boolean;

  nextRunAt:
    string | null;

  message:
    string;
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

      processed:
        0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed:
        false,

      nextRunAt:
        campaign.next_run_at,

      message:
        "La campaña no está en curso.",
    };
  }

  // ===================================================
  // PROVIDER
  // ===================================================

  const provider =
    getMessagingProvider(
      campaign.execution_mode
    );

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

      processed:
        0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed:
        false,

      nextRunAt:
        nextAllowed.toISOString(),

      message:
        "Campaña fuera de la franja horaria. Quedó programada para el próximo período permitido.",
    };
  }

  // ===================================================
  // PROCESSED LAST HOUR
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
    .in(
      "status",
      [
        "simulated",
        "sent",
      ]
    )
    .gte(
      campaign.execution_mode ===
      "simulation"
        ? "simulated_at"
        : "sent_at",

      hourAgo.toISOString()
    );

  // ===================================================
  // PROCESSED TODAY
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
    .in(
      "status",
      [
        "simulated",
        "sent",
      ]
    )
    .gte(
      campaign.execution_mode ===
      "simulation"
        ? "simulated_at"
        : "sent_at",

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
  // LIMITS
  // ===================================================

  if (
    availableHour <=
    0
  ) {
    const nextRun =
      new Date(
        now.getTime() +
          60 *
            60 *
            1000
      );

    const effective =
      getEffectiveNextRun(
        nextRun,
        now,
        schedule
      );

    await updateCampaignTiming(
      supabase,
      campaign.id,
      campaign.organization_id,
      {
        nextRunAt:
          effective.toISOString(),

        lastRunAt:
          now.toISOString(),
      }
    );

    return {
      campaignId,

      processed:
        0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed:
        false,

      nextRunAt:
        effective.toISOString(),

      message:
        "Se alcanzó el máximo configurado para la última hora.",
    };
  }

  if (
    availableDay <=
    0
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

      processed:
        0,

      remaining:
        await countPrepared(
          supabase,
          campaignId
        ),

      completed:
        false,

      nextRunAt:
        nextRun.toISOString(),

      message:
        "Se alcanzó el máximo diario. La campaña continuará en el próximo período permitido.",
    };
  }

  // ===================================================
  // RECIPIENTS DUE
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
        contact_id,
        rendered_message,
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
  // PROCESS RECIPIENTS
  // ===================================================

  let processed =
    0;

  for (
    const rawRecipient of
    dueRecipients
  ) {
    const recipient =
      rawRecipient as RecipientRow;

    // ===============================================
    // CONTACT
    // ===============================================

    const {
      data:
        contactData,

      error:
        contactError,
    } = await supabase
      .from(
        "contacts"
      )
      .select(
        `
          id,
          phone_e164,
          opted_in,
          status
        `
      )
      .eq(
        "id",
        recipient.contact_id
      )
      .eq(
        "organization_id",
        campaign.organization_id
      )
      .maybeSingle();

    if (
      contactError ||
      !contactData
    ) {
      await markFailed({
        supabase,

        recipientId:
          recipient.id,

        campaignId,

        attemptCount:
          recipient.attempt_count,

        error:
          "No se encontró el contacto.",
      });

      continue;
    }

    const contact =
      contactData as ContactRow;

    // ===============================================
    // CONTACT STATUS
    // ===============================================

    if (
      contact.status !==
      "active"
    ) {
      await supabase
        .from(
          "campaign_recipients"
        )
        .update({
          status:
            "skipped",

          error_message:
            "El contacto ya no está habilitado para recibir comunicaciones.",

          last_attempt_at:
            new Date().toISOString(),

          attempt_count:
            Number(
              recipient.attempt_count ??
              0
            ) + 1,
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
        );

      continue;
    }

    // ===============================================
    // CONSENTIMIENTO EN LIVE
    // ===============================================

    if (
      campaign.execution_mode ===
        "live" &&
      contact.opted_in !==
        true
    ) {
      await supabase
        .from(
          "campaign_recipients"
        )
        .update({
          status:
            "skipped",

          error_message:
            "El contacto no tiene consentimiento habilitado para mensajería en producción.",

          last_attempt_at:
            new Date().toISOString(),

          attempt_count:
            Number(
              recipient.attempt_count ??
              0
            ) + 1,
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
        );

      continue;
    }

    // ===============================================
    // CLAIM
    // ===============================================

    const processingAt =
      new Date().toISOString();

    const {
      data:
        claimed,
    } = await supabase
      .from(
        "campaign_recipients"
      )
      .update({
        status:
          "processing",

        last_attempt_at:
          processingAt,

        attempt_count:
          Number(
            recipient.attempt_count ??
            0
          ) + 1,
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

    if (!claimed) {
      continue;
    }

    // ===============================================
    // PROVIDER
    // ===============================================

    try {
      const result =
        await provider.sendMessage({
          recipientId:
            recipient.id,

          contactId:
            recipient.contact_id,

          phone:
            contact.phone_e164,

          message:
            recipient.rendered_message,
        });

      if (
        !result.success
      ) {
        await supabase
          .from(
            "campaign_recipients"
          )
          .update({
            status:
              "failed",

            error_message:
              result.error ??
              "El proveedor rechazó el mensaje.",

            external_message_id:
              result.externalMessageId,
          })
          .eq(
            "id",
            recipient.id
          )
          .eq(
            "campaign_id",
            campaignId
          );

        continue;
      }

      // =============================================
      // SUCCESS
      // =============================================

      await supabase
        .from(
          "campaign_recipients"
        )
        .update({
          status:
            campaign.execution_mode ===
            "simulation"
              ? "simulated"
              : "sent",

          simulated_at:
            result.simulatedAt,

          sent_at:
            result.sentAt,

          external_message_id:
            result.externalMessageId,

          error_message:
            null,
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
          "processing"
        );

      processed +=
        1;
    } catch (error) {
      await supabase
        .from(
          "campaign_recipients"
        )
        .update({
          status:
            "failed",

          error_message:
            error instanceof Error
              ? error.message
              : "Error inesperado del proveedor.",
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
          "processing"
        );
    }
  }

  // ===================================================
  // CAMPAIGN TOTALS
  // ===================================================

  const remaining =
    await countPrepared(
      supabase,
      campaignId
    );

  const sentCount =
    await countByStatus(
      supabase,
      campaignId,
      "sent"
    );

  const failedCount =
    await countByStatus(
      supabase,
      campaignId,
      "failed"
    );

  const processingCount =
    await countByStatus(
      supabase,
      campaignId,
      "processing"
    );

  if (
    remaining ===
      0 &&
    processingCount ===
      0
  ) {
    await supabase
      .from(
        "campaigns"
      )
      .update({
        status:
          "completed",

        sent_count:
          sentCount,

        failed_count:
          failedCount,

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

      remaining:
        0,

      completed:
        true,

      nextRunAt:
        null,

      message:
        campaign.execution_mode ===
        "simulation"
          ? `Simulación completada. Se procesaron ${processed} destinatarios en esta ejecución.`
          : `Campaña completada. Se procesaron ${processed} destinatarios en esta ejecución.`,
    };
  }

  // ===================================================
  // NEXT
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
      : new Date(
          now.getTime() +
            60 *
              1000
        );

  await supabase
    .from(
      "campaigns"
    )
    .update({
      sent_count:
        sentCount,

      failed_count:
        failedCount,

      next_run_at:
        nextRun.toISOString(),

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
    campaignId,

    processed,

    remaining,

    completed:
      false,

    nextRunAt:
      nextRun.toISOString(),

    message:
      campaign.execution_mode ===
      "simulation"
        ? `Se simularon ${processed} destinatarios. Quedan ${remaining} pendientes.`
        : `Se procesaron ${processed} destinatarios. Quedan ${remaining} pendientes.`,
  };
}

// =====================================================
// FAILED
// =====================================================

async function markFailed({
  supabase,
  recipientId,
  campaignId,
  attemptCount,
  error,
}: {
  supabase:
    SupabaseClient;

  recipientId:
    string;

  campaignId:
    string;

  attemptCount:
    number;

  error:
    string;
}) {
  await supabase
    .from(
      "campaign_recipients"
    )
    .update({
      status:
        "failed",

      error_message:
        error,

      last_attempt_at:
        new Date().toISOString(),

      attempt_count:
        Number(
          attemptCount ??
          0
        ) + 1,
    })
    .eq(
      "id",
      recipientId
    )
    .eq(
      "campaign_id",
      campaignId
    )
    .eq(
      "status",
      "prepared"
    );
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

  const processing =
    await countByStatus(
      supabase,
      campaign.id,
      "processing"
    );

  if (
    remaining ===
      0 &&
    processing ===
      0
  ) {
    const sentCount =
      await countByStatus(
        supabase,
        campaign.id,
        "sent"
      );

    const failedCount =
      await countByStatus(
        supabase,
        campaign.id,
        "failed"
      );

    await supabase
      .from(
        "campaigns"
      )
      .update({
        status:
          "completed",

        sent_count:
          sentCount,

        failed_count:
          failedCount,

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

      processed:
        0,

      remaining:
        0,

      completed:
        true,

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
      : new Date(
          now.getTime() +
            60 *
              1000
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

    processed:
      0,

    remaining,

    completed:
      false,

    nextRunAt:
      nextRun.toISOString(),

    message:
      "Todavía no llegó el horario del próximo destinatario.",
  };
}

// =====================================================
// COUNT PREPARED
// =====================================================

async function countPrepared(
  supabase:
    SupabaseClient,

  campaignId:
    string
) {
  return await countByStatus(
    supabase,
    campaignId,
    "prepared"
  );
}

// =====================================================
// COUNT STATUS
// =====================================================

async function countByStatus(
  supabase:
    SupabaseClient,

  campaignId:
    string,

  status:
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
      status
    );

  return count ??
    0;
}

// =====================================================
// NEXT PREPARED
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
    .limit(
      1
    )
    .maybeSingle();

  return data?.scheduled_for ??
    null;
}

// =====================================================
// UPDATE TIMING
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
// CONFIG
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
              day
            ) =>
              Number(
                day
              )
          )
          .filter(
            (
              day
            ) =>
              Number.isInteger(
                day
              ) &&
              day >= 1 &&
              day <= 7
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
// WINDOW
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
    start ===
      null ||
    end ===
      null
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
// NEXT EFFECTIVE
// =====================================================

function getEffectiveNextRun(
  candidateDate:
    Date,

  now:
    Date,

  schedule:
    WorkerSchedule
) {
  const candidate =
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
    new Date(
      date
    );

  for (
    let iteration =
      0;

    iteration <
    14;

    iteration +=
      1
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
// NEXT DAY
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
    let iteration =
      0;

    iteration <
    14;

    iteration +=
      1
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
// NEXT ARGENTINA DAY
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

  const nextDay =
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
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() +
      1,
    nextDay.getUTCDate(),
    Math.floor(
      minutes /
        60
    ),
    minutes %
      60
  );
}

// =====================================================
// DAY START
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
    hour <
      0 ||
    hour >
      23 ||
    minute <
      0 ||
    minute >
      59
  ) {
    return null;
  }

  return (
    hour *
      60 +
    minute
  );
}