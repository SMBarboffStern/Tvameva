import Link from "next/link";
import { Suspense } from "react";

import {
  redirect,
} from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// TIPOS
// =====================================================

type CampaignStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

type CampaignRow = {
  id: string;

  template_id:
    string | null;

  name: string;

  status:
    CampaignStatus;

  total_recipients:
    number;

  sent_count:
    number;

  failed_count:
    number;

  scheduled_start_at:
    string | null;

  next_run_at:
    string | null;

  created_at:
    string;

  schedule_config:
    unknown;
};

type TemplateRow = {
  id: string;
  name: string;
};

// =====================================================
// PAGE
// =====================================================

export default function CampaignsPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <CampaignsContent />
    </Suspense>
  );
}

// =====================================================
// CONTENT
// =====================================================

async function CampaignsContent() {
  const supabase =
    await createClient();

  // ===================================================
  // USER
  // ===================================================

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }

  // ===================================================
  // MEMBERSHIP
  // ===================================================

  const {
    data: membership,
  } = await supabase
    .from("memberships")
    .select(
      "organization_id"
    )
    .eq(
      "user_id",
      user.id
    )
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect(
      "/protected"
    );
  }

  // ===================================================
  // ORGANIZATION
  // ===================================================

  const {
    data: organization,
  } = await supabase
    .from("organizations")
    .select("name")
    .eq(
      "id",
      membership.organization_id
    )
    .maybeSingle();

  // ===================================================
  // CAMPAIGNS
  // ===================================================

  const {
    data,
    error,
  } = await supabase
    .from("campaigns")
    .select(
      `
        id,
        template_id,
        name,
        status,
        total_recipients,
        sent_count,
        failed_count,
        scheduled_start_at,
        next_run_at,
        schedule_config,
        created_at
      `
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .order(
      "created_at",
      {
        ascending:
          false,
      }
    );

  if (error) {
    console.error(
      "Error cargando campañas:",
      error
    );
  }

  const campaigns =
    (data ??
      []) as CampaignRow[];

  // ===================================================
  // TEMPLATES
  // ===================================================

  const {
    data: templateData,
  } = await supabase
    .from("templates")
    .select(
      `
        id,
        name
      `
    )
    .eq(
      "organization_id",
      membership.organization_id
    );

  const templates =
    (templateData ??
      []) as TemplateRow[];

  const templateNames =
    new Map(
      templates.map(
        (template) => [
          template.id,
          template.name,
        ]
      )
    );

  // ===================================================
  // METRICS
  // ===================================================

  const readyCount =
    campaigns.filter(
      (campaign) =>
        campaign.status ===
        "ready"
    ).length;

  const runningCount =
    campaigns.filter(
      (campaign) =>
        campaign.status ===
        "running"
    ).length;

  const completedCount =
    campaigns.filter(
      (campaign) =>
        campaign.status ===
        "completed"
    ).length;

  // ===================================================
  // UI
  // ===================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-5">
          <div>
            <h1 className="text-2xl font-bold">
              Tvameva
            </h1>

            <p className="text-sm text-slate-400">
              {organization?.name ??
                "Organización"}
            </p>
          </div>

          <Link
            href="/protected"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            Volver al panel
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Campaign Engine
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              Campañas
            </h2>

            <p className="mt-2 max-w-2xl text-slate-400">
              Prepará, programá y administrá
              tus lotes de mensajes.
            </p>
          </div>

          <Link
            href="/protected/campanas/nueva"
            className="rounded-xl bg-emerald-500 px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            + Nueva campaña
          </Link>
        </div>

        {/* METRICS */}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total"
            value={
              campaigns.length
            }
          />

          <MetricCard
            title="Preparadas"
            value={
              readyCount
            }
          />

          <MetricCard
            title="En curso"
            value={
              runningCount
            }
          />

          <MetricCard
            title="Completadas"
            value={
              completedCount
            }
          />
        </div>

        {/* CAMPAIGNS */}

        {campaigns.length >
        0 ? (
          <div className="mt-7 space-y-4">
            {campaigns.map(
              (campaign) => {
                const schedule =
                  getScheduleConfig(
                    campaign.schedule_config
                  );

                const templateName =
                  campaign.template_id
                    ? templateNames.get(
                        campaign.template_id
                      ) ??
                      "Plantilla eliminada"
                    : "Sin plantilla";

                return (
                  <div
                    key={
                      campaign.id
                    }
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/20"
                  >
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-xl font-semibold">
                            {campaign.name}
                          </h3>

                          <StatusBadge
                            status={
                              campaign.status
                            }
                          />
                        </div>

                        <p className="mt-2 text-sm text-slate-500">
                          Plantilla:{" "}
                          {templateName}
                        </p>
                      </div>

                      <div className="text-left lg:text-right">
                        <p className="text-xs uppercase tracking-wider text-slate-600">
                          Próximo procesamiento
                        </p>

                        <p className="mt-1 text-sm font-medium text-emerald-400">
                          {campaign.next_run_at
                            ? formatDateTime(
                                campaign.next_run_at
                              )
                            : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <SmallCard
                        title="Destinatarios"
                        value={String(
                          campaign.total_recipients
                        )}
                      />

                      <SmallCard
                        title="Enviados"
                        value={String(
                          campaign.sent_count
                        )}
                      />

                      <SmallCard
                        title="Fallidos"
                        value={String(
                          campaign.failed_count
                        )}
                      />

                      <SmallCard
                        title="Máx. / hora"
                        value={String(
                          schedule.maxPerHour ??
                            "—"
                        )}
                      />

                      <SmallCard
                        title="Máx. / día"
                        value={String(
                          schedule.maxPerDay ??
                            "—"
                        )}
                      />
                    </div>

                    <div className="mt-5 flex flex-col justify-between gap-4 border-t border-white/5 pt-5 lg:flex-row lg:items-center">
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>
                          Horario:{" "}
                          {schedule.windowStart ??
                            "—"}
                          {" – "}
                          {schedule.windowEnd ??
                            "—"}
                        </span>

                        <span>
                          Inicio:{" "}
                          {campaign.scheduled_start_at
                            ? formatDateTime(
                                campaign.scheduled_start_at
                              )
                            : "—"}
                        </span>

                        <span>
                          Creada:{" "}
                          {formatDateTime(
                            campaign.created_at
                          )}
                        </span>
                      </div>

                      <Link
                        href={`/protected/campanas/${campaign.id}`}
                        className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-2 text-center text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/10"
                      >
                        Ver campaña →
                      </Link>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        ) : (
          <div className="mt-7 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
            <div className="text-4xl">
              🚀
            </div>

            <h3 className="mt-5 text-xl font-semibold">
              Todavía no hay campañas
            </h3>

            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
              Creá la primera campaña para
              probar el Campaign Engine de
              Tvameva.
            </p>

            <Link
              href="/protected/campanas/nueva"
              className="mt-6 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950"
            >
              Crear primera campaña
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

// =====================================================
// METRIC
// =====================================================

function MetricCard({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// SMALL CARD
// =====================================================

function SmallCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-900/60 p-4">
      <p className="text-xs text-slate-600">
        {title}
      </p>

      <p className="mt-1 font-semibold text-slate-200">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// STATUS
// =====================================================

function StatusBadge({
  status,
}: {
  status: CampaignStatus;
}) {
  const labels:
    Record<
      CampaignStatus,
      string
    > = {
    draft:
      "Borrador",

    ready:
      "Preparada",

    running:
      "En curso",

    paused:
      "Pausada",

    completed:
      "Completada",

    cancelled:
      "Cancelada",
  };

  const classes:
    Record<
      CampaignStatus,
      string
    > = {
    draft:
      "bg-white/5 text-slate-400",

    ready:
      "bg-blue-500/10 text-blue-300",

    running:
      "bg-emerald-500/10 text-emerald-300",

    paused:
      "bg-amber-500/10 text-amber-200",

    completed:
      "bg-violet-500/10 text-violet-300",

    cancelled:
      "bg-red-500/10 text-red-300",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${classes[status]}`}
    >
      {labels[status]}
    </span>
  );
}

// =====================================================
// CONFIG
// =====================================================

function getScheduleConfig(
  value: unknown
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {
      windowStart:
        null,

      windowEnd:
        null,

      maxPerHour:
        null,

      maxPerDay:
        null,
    };
  }

  const config =
    value as Record<
      string,
      unknown
    >;

  return {
    windowStart:
      typeof config.windowStart ===
      "string"
        ? config.windowStart
        : null,

    windowEnd:
      typeof config.windowEnd ===
      "string"
        ? config.windowEnd
        : null,

    maxPerHour:
      typeof config.maxPerHour ===
      "number"
        ? config.maxPerHour
        : null,

    maxPerDay:
      typeof config.maxPerDay ===
      "number"
        ? config.maxPerDay
        : null,
  };
}

// =====================================================
// DATE
// =====================================================

function formatDateTime(
  value: string
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      timeZone:
        "America/Argentina/Buenos_Aires",

      day:
        "2-digit",

      month:
        "2-digit",

      year:
        "numeric",

      hour:
        "2-digit",

      minute:
        "2-digit",
    }
  ).format(date);
}

// =====================================================
// LOADING
// =====================================================

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-400">
          Tvameva
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Cargando campañas...
        </p>
      </div>
    </main>
  );
}