import Link from "next/link";
import { Suspense } from "react";

import {
  notFound,
  redirect,
} from "next/navigation";

import {
  revalidatePath,
} from "next/cache";

import { createClient } from "@/lib/supabase/server";

import CampaignWorkerControls from "@/components/campaign-worker-controls";

// =====================================================
// TIPOS
// =====================================================

type CampaignPageProps = {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    page?: string;
    status?: string;
  }>;
};

type CampaignStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

type RecipientStatus =
  | "pending"
  | "processing"
  | "prepared"
  | "simulated"
  | "sent"
  | "failed"
  | "skipped";

type ExecutionMode =
  | "simulation"
  | "live";

type CampaignRecord = {
  id: string;

  organization_id: string;

  template_id: string | null;

  name: string;

  status: CampaignStatus;

  execution_mode:
    ExecutionMode;

  total_recipients:
    number;

  sent_count:
    number;

  failed_count:
    number;

  greeting_config:
    unknown;

  schedule_config:
    unknown;

  scheduled_start_at:
    string | null;

  next_run_at:
    string | null;

  last_run_at:
    string | null;

  created_at:
    string;
};

type RecipientRecord = {
  id: string;

  contact_id:
    string;

  rendered_message:
    string;

  status:
    RecipientStatus;

  error_message:
    string | null;

  external_message_id:
    string | null;

  sent_at:
    string | null;

  scheduled_for:
    string | null;

  attempt_count:
    number;

  last_attempt_at:
    string | null;

  simulated_at:
    string | null;
};

type ContactRecord = {
  id: string;

  first_name:
    string | null;

  last_name:
    string | null;

  phone_e164:
    string;

  email:
    string | null;
};

// =====================================================
// CONFIG
// =====================================================

const PAGE_SIZE = 50;

// =====================================================
// PAGE
// =====================================================

export default function CampaignPage({
  params,
  searchParams,
}: CampaignPageProps) {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <CampaignContent
        params={params}
        searchParams={
          searchParams
        }
      />
    </Suspense>
  );
}

// =====================================================
// CONTENT
// =====================================================

async function CampaignContent({
  params,
  searchParams,
}: CampaignPageProps) {
  const {
    id,
  } = await params;

  const queryParams =
    await searchParams;

  const supabase =
    await createClient();

  // ===================================================
  // AUTH
  // ===================================================

  const {
    data: {
      user,
    },
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
    .from(
      "memberships"
    )
    .select(
      `
        organization_id,
        role
      `
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
  // CAMPAIGN
  // ===================================================

  const {
    data:
      campaignData,

    error:
      campaignError,
  } = await supabase
    .from(
      "campaigns"
    )
    .select(
      `
        id,
        organization_id,
        template_id,
        name,
        status,
        execution_mode,
        total_recipients,
        sent_count,
        failed_count,
        greeting_config,
        schedule_config,
        scheduled_start_at,
        next_run_at,
        last_run_at,
        created_at
      `
    )
    .eq(
      "id",
      id
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .maybeSingle();

  if (
    campaignError ||
    !campaignData
  ) {
    notFound();
  }

  const campaign =
    campaignData as CampaignRecord;

  // ===================================================
  // ORGANIZATION
  // ===================================================

  const {
    data:
      organization,
  } = await supabase
    .from(
      "organizations"
    )
    .select(
      "name"
    )
    .eq(
      "id",
      membership.organization_id
    )
    .maybeSingle();

  // ===================================================
  // TEMPLATE
  // ===================================================

  let templateName =
    "Sin plantilla";

  if (
    campaign.template_id
  ) {
    const {
      data:
        template,
    } = await supabase
      .from(
        "templates"
      )
      .select(
        "name"
      )
      .eq(
        "id",
        campaign.template_id
      )
      .eq(
        "organization_id",
        membership.organization_id
      )
      .maybeSingle();

    templateName =
      template?.name ??
      "Plantilla eliminada";
  }

  // ===================================================
  // FILTER
  // ===================================================

  const rawStatus =
    String(
      queryParams.status ??
      ""
    );

  const recipientStatus:
    RecipientStatus |
    "all" =
      isRecipientStatus(
        rawStatus
      )
        ? rawStatus
        : "all";

  const requestedPage =
    Number.parseInt(
      String(
        queryParams.page ??
        "1"
      ),
      10
    );

  const currentPage =
    Number.isFinite(
      requestedPage
    ) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const from =
    (currentPage - 1) *
    PAGE_SIZE;

  const to =
    from +
    PAGE_SIZE -
    1;

  // ===================================================
  // COUNTS
  // ===================================================

  const [
    totalResult,
    preparedResult,
    simulatedResult,
    sentResult,
    failedResult,
    skippedResult,
  ] =
    await Promise.all([
      countRecipients(
        supabase,
        id
      ),

      countRecipients(
        supabase,
        id,
        "prepared"
      ),

      countRecipients(
        supabase,
        id,
        "simulated"
      ),

      countRecipients(
        supabase,
        id,
        "sent"
      ),

      countRecipients(
        supabase,
        id,
        "failed"
      ),

      countRecipients(
        supabase,
        id,
        "skipped"
      ),
    ]);

  // ===================================================
  // RECIPIENTS
  // ===================================================

  let recipientsQuery =
    supabase
      .from(
        "campaign_recipients"
      )
      .select(
        `
          id,
          contact_id,
          rendered_message,
          status,
          error_message,
          external_message_id,
          sent_at,
          scheduled_for,
          attempt_count,
          last_attempt_at,
          simulated_at
        `,
        {
          count:
            "exact",
        }
      )
      .eq(
        "campaign_id",
        id
      );

  if (
    recipientStatus !==
    "all"
  ) {
    recipientsQuery =
      recipientsQuery.eq(
        "status",
        recipientStatus
      );
  }

  const {
    data:
      recipientData,

    count:
      filteredCount,

    error:
      recipientsError,
  } =
    await recipientsQuery
      .order(
        "scheduled_for",
        {
          ascending:
            true,
        }
      )
      .range(
        from,
        to
      );

  if (
    recipientsError
  ) {
    console.error(
      "Error cargando destinatarios:",
      recipientsError
    );
  }

  const recipients =
    (recipientData ??
      []) as RecipientRecord[];

  // ===================================================
  // CONTACTS
  // ===================================================

  const contactIds =
    Array.from(
      new Set(
        recipients.map(
          (
            recipient
          ) =>
            recipient.contact_id
        )
      )
    );

  const contactsMap =
    new Map<
      string,
      ContactRecord
    >();

  if (
    contactIds.length >
    0
  ) {
    const {
      data:
        contacts,
    } = await supabase
      .from(
        "contacts"
      )
      .select(
        `
          id,
          first_name,
          last_name,
          phone_e164,
          email
        `
      )
      .eq(
        "organization_id",
        membership.organization_id
      )
      .in(
        "id",
        contactIds
      );

    for (
      const contact of
      (contacts ??
        []) as ContactRecord[]
    ) {
      contactsMap.set(
        contact.id,
        contact
      );
    }
  }

  const totalFiltered =
    filteredCount ??
    0;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalFiltered /
        PAGE_SIZE
      )
    );

  const schedule =
    getScheduleConfig(
      campaign.schedule_config
    );

  const greeting =
    getGreetingConfig(
      campaign.greeting_config
    );

  // ===================================================
  // START / RESUME
  // ===================================================

  async function startCampaign() {
    "use server";

    const context =
      await getCampaignActionContext(
        id
      );

    if (
      context.campaign.status !==
        "ready" &&
      context.campaign.status !==
        "paused"
    ) {
      redirect(
        `/protected/campanas/${id}`
      );
    }

    const currentNextRun =
      context.campaign.next_run_at
        ? new Date(
            context.campaign.next_run_at
          )
        : null;

    const now =
      new Date();

    const nextRunAt =
      !currentNextRun ||
      Number.isNaN(
        currentNextRun.getTime()
      ) ||
      currentNextRun <
        now
        ? now.toISOString()
        : currentNextRun.toISOString();

    const {
      error,
    } =
      await context.supabase
        .from(
          "campaigns"
        )
        .update({
          status:
            "running",

          next_run_at:
            nextRunAt,
        })
        .eq(
          "id",
          id
        )
        .eq(
          "organization_id",
          context.membership.organization_id
        );

    if (error) {
      console.error(
        "Error iniciando campaña:",
        error
      );

      throw new Error(
        "No se pudo iniciar la campaña."
      );
    }

    revalidateCampaignPaths(
      id
    );

    redirect(
      `/protected/campanas/${id}`
    );
  }

  // ===================================================
  // PAUSE
  // ===================================================

  async function pauseCampaign() {
    "use server";

    const context =
      await getCampaignActionContext(
        id
      );

    if (
      context.campaign.status ===
      "running"
    ) {
      const {
        error,
      } =
        await context.supabase
          .from(
            "campaigns"
          )
          .update({
            status:
              "paused",
          })
          .eq(
            "id",
            id
          )
          .eq(
            "organization_id",
            context.membership.organization_id
          );

      if (error) {
        console.error(
          "Error pausando campaña:",
          error
        );

        throw new Error(
          "No se pudo pausar la campaña."
        );
      }
    }

    revalidateCampaignPaths(
      id
    );

    redirect(
      `/protected/campanas/${id}`
    );
  }

  // ===================================================
  // CANCEL
  // ===================================================

  async function cancelCampaign() {
    "use server";

    const context =
      await getCampaignActionContext(
        id
      );

    if (
      context.campaign.status ===
        "completed" ||
      context.campaign.status ===
        "cancelled"
    ) {
      redirect(
        `/protected/campanas/${id}`
      );
    }

    // ===============================================
    // OMITIR LOS QUE TODAVÍA NO FUERON PROCESADOS
    // ===============================================

    const {
      error:
        recipientsError,
    } =
      await context.supabase
        .from(
          "campaign_recipients"
        )
        .update({
          status:
            "skipped",

          error_message:
            "Campaña cancelada antes del procesamiento.",
        })
        .eq(
          "campaign_id",
          id
        )
        .in(
          "status",
          [
            "pending",
            "prepared",
            "processing",
          ]
        );

    if (
      recipientsError
    ) {
      console.error(
        "Error cancelando destinatarios:",
        recipientsError
      );

      throw new Error(
        "No se pudieron cancelar los destinatarios pendientes."
      );
    }

    // ===============================================
    // CANCELAR CAMPAÑA
    // ===============================================

    const {
      error:
        campaignError,
    } =
      await context.supabase
        .from(
          "campaigns"
        )
        .update({
          status:
            "cancelled",

          next_run_at:
            null,
        })
        .eq(
          "id",
          id
        )
        .eq(
          "organization_id",
          context.membership.organization_id
        );

    if (
      campaignError
    ) {
      console.error(
        "Error cancelando campaña:",
        campaignError
      );

      throw new Error(
        "No se pudo cancelar la campaña."
      );
    }

    revalidateCampaignPaths(
      id
    );

    redirect(
      `/protected/campanas/${id}`
    );
  }

  // ===================================================
  // UI
  // ===================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* HEADER */}

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
            href="/protected/campanas"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            ← Volver a campañas
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        {/* CAMPAIGN HEADER */}

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Campaña
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold">
                {campaign.name}
              </h2>

              <CampaignStatusBadge
                status={
                  campaign.status
                }
              />

              <ExecutionModeBadge
                mode={
                  campaign.execution_mode
                }
              />
            </div>

            <p className="mt-3 text-sm text-slate-400">
              Plantilla:{" "}
              <span className="text-slate-200">
                {templateName}
              </span>
            </p>
          </div>

          {/* ACTIONS */}

          <div className="flex flex-wrap gap-3">
            {campaign.status ===
              "ready" && (
              <form
                action={
                  startCampaign
                }
              >
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Iniciar campaña
                </button>
              </form>
            )}

            {campaign.status ===
              "paused" && (
              <form
                action={
                  startCampaign
                }
              >
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Reanudar campaña
                </button>
              </form>
            )}

            {campaign.status ===
              "running" && (
              <form
                action={
                  pauseCampaign
                }
              >
                <button
                  type="submit"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 font-semibold text-amber-200 transition hover:bg-amber-500/20"
                >
                  Pausar campaña
                </button>
              </form>
            )}

            {campaign.status !==
              "completed" &&
              campaign.status !==
                "cancelled" && (
                <form
                  action={
                    cancelCampaign
                  }
                >
                  <button
                    type="submit"
                    className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3 font-semibold text-red-300 transition hover:bg-red-500/10"
                  >
                    Cancelar campaña
                  </button>
                </form>
              )}
          </div>
        </div>

        {/* SIMULATION NOTICE */}

        {campaign.execution_mode ===
          "simulation" && (
          <div className="mt-7 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-5">
            <p className="font-medium text-blue-200">
              Modo simulación
            </p>

            <p className="mt-1 text-sm leading-6 text-blue-100/60">
              Tvameva está probando el motor de
              campañas sin enviar mensajes
              reales. El worker procesa la cola,
              horarios y límites, pero no se
              conecta a WhatsApp.
            </p>
          </div>
        )}

        {/* METRICS */}

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <MetricCard
            title="Total"
            value={
              totalResult
            }
            text="Destinatarios"
          />

          <MetricCard
            title="Preparados"
            value={
              preparedResult
            }
            text="Esperando turno"
          />

          <MetricCard
            title="Simulados"
            value={
              simulatedResult
            }
            text="Procesados en prueba"
          />

          <MetricCard
            title="Enviados"
            value={
              sentResult
            }
            text="Reales"
          />

          <MetricCard
            title="Fallidos"
            value={
              failedResult
            }
            text="Con error"
          />

          <MetricCard
            title="Omitidos"
            value={
              skippedResult
            }
            text="No procesados"
          />
        </div>

        {/* WORKER */}

        <div className="mt-7">
          <CampaignWorkerControls
            campaignId={
              campaign.id
            }
            status={
              campaign.status
            }
            executionMode={
              campaign.execution_mode
            }
          />
        </div>

        {/* CONFIG */}

        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          {/* PROGRAMACIÓN */}

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Programación
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InfoCard
                title="Inicio"
                value={
                  campaign.scheduled_start_at
                    ? formatDateTime(
                        campaign.scheduled_start_at
                      )
                    : "—"
                }
              />

              <InfoCard
                title="Próximo proceso"
                value={
                  campaign.next_run_at
                    ? formatDateTime(
                        campaign.next_run_at
                      )
                    : "—"
                }
              />

              <InfoCard
                title="Último proceso"
                value={
                  campaign.last_run_at
                    ? formatDateTime(
                        campaign.last_run_at
                      )
                    : "Todavía ninguno"
                }
              />

              <InfoCard
                title="Horario"
                value={
                  `${schedule.windowStart} – ${schedule.windowEnd}`
                }
              />

              <InfoCard
                title="Máximo / hora"
                value={String(
                  schedule.maxPerHour
                )}
              />

              <InfoCard
                title="Máximo / día"
                value={String(
                  schedule.maxPerDay
                )}
              />

              <InfoCard
                title="Días"
                value={
                  formatWeekdays(
                    schedule.allowedWeekdays
                  )
                }
              />

              <InfoCard
                title="Continuar otro día"
                value={
                  schedule.continueNextDay
                    ? "Sí"
                    : "No"
                }
              />
            </div>
          </section>

          {/* PERSONALIZATION */}

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Personalización
            </p>

            <div className="mt-5 grid gap-4">
              <InfoCard
                title="Tipo de saludo"
                value={
                  greetingModeLabel(
                    greeting.mode
                  )
                }
              />

              {greeting.mode ===
                "fixed" && (
                <InfoCard
                  title="Saludo fijo"
                  value={
                    greeting.fixed ||
                    "—"
                  }
                />
              )}

              {greeting.mode ===
                "varied" && (
                <InfoCard
                  title="Variantes"
                  value={`${greeting.variants.length} saludos habilitados`}
                />
              )}

              <InfoCard
                title="Modo de ejecución"
                value={
                  campaign.execution_mode ===
                  "simulation"
                    ? "Simulación"
                    : "Producción"
                }
              />

              <InfoCard
                title="Campaña creada"
                value={
                  formatDateTime(
                    campaign.created_at
                  )
                }
              />
            </div>
          </section>
        </div>

        {/* FILTERS */}

        <div className="mt-7 flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:flex-row md:items-center">
          <div>
            <h3 className="font-semibold">
              Destinatarios
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Página {currentPage} de{" "}
              {totalPages}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="all"
              label="Todos"
            />

            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="prepared"
              label="Preparados"
            />

            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="simulated"
              label="Simulados"
            />

            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="sent"
              label="Enviados"
            />

            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="failed"
              label="Fallidos"
            />

            <StatusFilter
              id={id}
              current={
                recipientStatus
              }
              value="skipped"
              label="Omitidos"
            />
          </div>
        </div>

        {/* RECIPIENTS */}

        <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          {recipients.length >
          0 ? (
            <div className="divide-y divide-white/5">
              {recipients.map(
                (
                  recipient,
                  index
                ) => {
                  const contact =
                    contactsMap.get(
                      recipient.contact_id
                    );

                  const fullName =
                    [
                      contact?.first_name,
                      contact?.last_name,
                    ]
                      .filter(
                        Boolean
                      )
                      .join(
                        " "
                      ) ||
                    "Contacto";

                  return (
                    <div
                      key={
                        recipient.id
                      }
                      className="grid gap-5 p-6 xl:grid-cols-[220px_210px_1fr]"
                    >
                      {/* PERSONA */}

                      <div>
                        <p className="text-xs text-slate-600">
                          #
                          {from +
                            index +
                            1}
                        </p>

                        <p className="mt-2 font-semibold text-slate-200">
                          {
                            fullName
                          }
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {contact?.phone_e164 ||
                            "—"}
                        </p>

                        {contact?.email && (
                          <p className="mt-1 break-all text-xs text-slate-600">
                            {
                              contact.email
                            }
                          </p>
                        )}
                      </div>

                      {/* STATUS */}

                      <div>
                        <RecipientStatusBadge
                          status={
                            recipient.status
                          }
                        />

                        <p className="mt-3 text-xs text-slate-500">
                          Programado
                        </p>

                        <p className="mt-1 text-sm font-medium text-emerald-400">
                          {recipient.scheduled_for
                            ? formatDateTime(
                                recipient.scheduled_for
                              )
                            : "—"}
                        </p>

                        {recipient.simulated_at && (
                          <>
                            <p className="mt-3 text-xs text-slate-500">
                              Simulado
                            </p>

                            <p className="mt-1 text-sm text-violet-300">
                              {formatDateTime(
                                recipient.simulated_at
                              )}
                            </p>
                          </>
                        )}

                        {recipient.sent_at && (
                          <>
                            <p className="mt-3 text-xs text-slate-500">
                              Enviado
                            </p>

                            <p className="mt-1 text-sm text-violet-300">
                              {formatDateTime(
                                recipient.sent_at
                              )}
                            </p>
                          </>
                        )}

                        <p className="mt-3 text-xs text-slate-600">
                          Intentos:{" "}
                          {
                            recipient.attempt_count
                          }
                        </p>
                      </div>

                      {/* MESSAGE */}

                      <details className="rounded-2xl border border-white/5 bg-slate-900/50 p-4">
                        <summary className="cursor-pointer select-none text-sm font-medium text-slate-300">
                          Ver mensaje preparado
                        </summary>

                        <div className="mt-4 rounded-2xl bg-[#005c4b] p-4">
                          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white">
                            {
                              recipient.rendered_message
                            }
                          </p>
                        </div>

                        {recipient.external_message_id && (
                          <p className="mt-3 break-all text-xs text-slate-600">
                            ID:{" "}
                            {
                              recipient.external_message_id
                            }
                          </p>
                        )}

                        {recipient.error_message && (
                          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                            {
                              recipient.error_message
                            }
                          </div>
                        )}
                      </details>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div className="p-12 text-center">
              <p className="font-medium text-slate-300">
                No hay destinatarios con este estado.
              </p>
            </div>
          )}
        </div>

        {/* PAGINATION */}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            {totalFiltered === 0
              ? "0 registros"
              : `${from + 1}–${Math.min(
                  to + 1,
                  totalFiltered
                )} de ${totalFiltered}`}
          </p>

          <div className="flex gap-2">
            {currentPage >
            1 ? (
              <Link
                href={buildPageUrl(
                  id,
                  recipientStatus,
                  currentPage -
                    1
                )}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                ← Anterior
              </Link>
            ) : (
              <span className="rounded-xl border border-white/5 px-4 py-2 text-sm text-slate-700">
                ← Anterior
              </span>
            )}

            {currentPage <
            totalPages ? (
              <Link
                href={buildPageUrl(
                  id,
                  recipientStatus,
                  currentPage +
                    1
                )}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                Siguiente →
              </Link>
            ) : (
              <span className="rounded-xl border border-white/5 px-4 py-2 text-sm text-slate-700">
                Siguiente →
              </span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// =====================================================
// ACTION CONTEXT
// =====================================================

async function getCampaignActionContext(
  campaignId:
    string
) {
  const supabase =
    await createClient();

  const {
    data: {
      user,
    },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }

  const {
    data:
      membership,
  } = await supabase
    .from(
      "memberships"
    )
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

  const {
    data:
      campaign,
  } = await supabase
    .from(
      "campaigns"
    )
    .select(
      `
        id,
        status,
        next_run_at
      `
    )
    .eq(
      "id",
      campaignId
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .maybeSingle();

  if (!campaign) {
    notFound();
  }

  return {
    supabase,
    membership,
    campaign,
  };
}

// =====================================================
// COUNTS
// =====================================================

async function countRecipients(
  supabase:
    Awaited<
      ReturnType<
        typeof createClient
      >
    >,

  campaignId:
    string,

  status?:
    RecipientStatus
) {
  let query =
    supabase
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
      );

  if (status) {
    query =
      query.eq(
        "status",
        status
      );
  }

  const {
    count,
  } =
    await query;

  return count ??
    0;
}

// =====================================================
// REVALIDATE
// =====================================================

function revalidateCampaignPaths(
  id: string
) {
  revalidatePath(
    `/protected/campanas/${id}`
  );

  revalidatePath(
    "/protected/campanas"
  );

  revalidatePath(
    "/protected"
  );
}

// =====================================================
// SCHEDULE CONFIG
// =====================================================

function getScheduleConfig(
  value: unknown
) {
  const fallback = {
    windowStart:
      "—",

    windowEnd:
      "—",

    maxPerHour:
      0,

    maxPerDay:
      0,

    continueNextDay:
      false,

    allowedWeekdays:
      [] as number[],
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

  return {
    windowStart:
      typeof config.windowStart ===
      "string"
        ? config.windowStart
        : "—",

    windowEnd:
      typeof config.windowEnd ===
      "string"
        ? config.windowEnd
        : "—",

    maxPerHour:
      Number(
        config.maxPerHour ??
        0
      ),

    maxPerDay:
      Number(
        config.maxPerDay ??
        0
      ),

    continueNextDay:
      config.continueNextDay ===
      true,

    allowedWeekdays:
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
        : [],
  };
}

// =====================================================
// GREETING CONFIG
// =====================================================

function getGreetingConfig(
  value: unknown
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value
    )
  ) {
    return {
      mode:
        "automatic",

      fixed:
        "",

      variants:
        [] as string[],
    };
  }

  const config =
    value as Record<
      string,
      unknown
    >;

  const mode =
    config.mode ===
      "fixed" ||
    config.mode ===
      "varied"
      ? config.mode
      : "automatic";

  return {
    mode,

    fixed:
      String(
        config.fixed ??
        ""
      ),

    variants:
      Array.isArray(
        config.variants
      )
        ? config.variants.map(
            (
              item
            ) =>
              String(
                item
              )
          )
        : [],
  };
}

// =====================================================
// VALID STATUS
// =====================================================

function isRecipientStatus(
  value: string
): value is RecipientStatus {
  return [
    "pending",
    "processing",
    "prepared",
    "simulated",
    "sent",
    "failed",
    "skipped",
  ].includes(
    value
  );
}

// =====================================================
// URL
// =====================================================

function buildPageUrl(
  id: string,

  status:
    RecipientStatus |
    "all",

  page: number
) {
  const params =
    new URLSearchParams();

  if (
    status !==
    "all"
  ) {
    params.set(
      "status",
      status
    );
  }

  if (
    page > 1
  ) {
    params.set(
      "page",
      String(
        page
      )
    );
  }

  const query =
    params.toString();

  return query
    ? `/protected/campanas/${id}?${query}`
    : `/protected/campanas/${id}`;
}

// =====================================================
// FILTER
// =====================================================

function StatusFilter({
  id,
  current,
  value,
  label,
}: {
  id: string;

  current:
    RecipientStatus |
    "all";

  value:
    RecipientStatus |
    "all";

  label:
    string;
}) {
  const active =
    current ===
    value;

  const href =
    value === "all"
      ? `/protected/campanas/${id}`
      : `/protected/campanas/${id}?status=${value}`;

  return (
    <Link
      href={href}
      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
        active
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 text-slate-500 hover:bg-white/5"
      }`}
    >
      {label}
    </Link>
  );
}

// =====================================================
// CAMPAIGN STATUS
// =====================================================

function CampaignStatusBadge({
  status,
}: {
  status:
    CampaignStatus;
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
      className={`rounded-full px-3 py-1.5 text-xs font-medium ${classes[status]}`}
    >
      {
        labels[
          status
        ]
      }
    </span>
  );
}

// =====================================================
// EXECUTION MODE
// =====================================================

function ExecutionModeBadge({
  mode,
}: {
  mode:
    ExecutionMode;
}) {
  if (
    mode ===
    "simulation"
  ) {
    return (
      <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300">
        SIMULACIÓN
      </span>
    );
  }

  return (
    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
      PRODUCCIÓN
    </span>
  );
}

// =====================================================
// RECIPIENT STATUS
// =====================================================

function RecipientStatusBadge({
  status,
}: {
  status:
    RecipientStatus;
}) {
  const labels:
    Record<
      RecipientStatus,
      string
    > = {
    pending:
      "Pendiente",

    processing:
      "Procesando",

    prepared:
      "Preparado",

    simulated:
      "Simulado",

    sent:
      "Enviado",

    failed:
      "Fallido",

    skipped:
      "Omitido",
  };

  const classes:
    Record<
      RecipientStatus,
      string
    > = {
    pending:
      "bg-white/5 text-slate-400",

    processing:
      "bg-blue-500/10 text-blue-300",

    prepared:
      "bg-emerald-500/10 text-emerald-300",

    simulated:
      "bg-violet-500/10 text-violet-300",

    sent:
      "bg-cyan-500/10 text-cyan-300",

    failed:
      "bg-red-500/10 text-red-300",

    skipped:
      "bg-amber-500/10 text-amber-200",
  };

  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${classes[status]}`}
    >
      {
        labels[
          status
        ]
      }
    </span>
  );
}

// =====================================================
// METRIC
// =====================================================

function MetricCard({
  title,
  value,
  text,
}: {
  title:
    string;

  value:
    number;

  text:
    string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-600">
        {text}
      </p>
    </div>
  );
}

// =====================================================
// INFO
// =====================================================

function InfoCard({
  title,
  value,
}: {
  title:
    string;

  value:
    string;
}) {
  return (
    <div className="rounded-2xl bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wider text-slate-600">
        {title}
      </p>

      <p className="mt-2 break-words text-sm font-medium text-slate-200">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// GREETING LABEL
// =====================================================

function greetingModeLabel(
  mode: string
) {
  if (
    mode ===
    "fixed"
  ) {
    return "Fijo";
  }

  if (
    mode ===
    "varied"
  ) {
    return "Variado";
  }

  return "Automático según horario";
}

// =====================================================
// WEEKDAYS
// =====================================================

function formatWeekdays(
  values:
    number[]
) {
  const labels:
    Record<
      number,
      string
    > = {
    1:
      "Lun",

    2:
      "Mar",

    3:
      "Mié",

    4:
      "Jue",

    5:
      "Vie",

    6:
      "Sáb",

    7:
      "Dom",
  };

  if (
    values.length ===
    0
  ) {
    return "—";
  }

  return values
    .map(
      (
        value
      ) =>
        labels[
          value
        ]
    )
    .filter(
      Boolean
    )
    .join(
      ", "
    );
}

// =====================================================
// DATE
// =====================================================

function formatDateTime(
  value: string
) {
  const date =
    new Date(
      value
    );

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
  ).format(
    date
  );
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
          Cargando campaña...
        </p>
      </div>
    </main>
  );
}