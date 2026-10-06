"use client";

import Link from "next/link";

import {
  useActionState,
  useMemo,
  useState,
} from "react";

import {
  useFormStatus,
} from "react-dom";

import {
  buildCampaignRecipients,
} from "@/lib/campaigns/engine";

import type {
  CampaignContact,
  CampaignGreetingConfig,
  CampaignScheduleConfig,
  BuiltCampaignRecipient,
} from "@/lib/campaigns/engine";

// =====================================================
// TIPOS
// =====================================================

export type CampaignBuilderTemplate = {
  id: string;
  name: string;
  body: string;
};

export type CampaignBuilderContact =
  CampaignContact;

export type CampaignActionState = {
  error: string | null;
};

type CampaignBuilderProps = {
  templates:
    CampaignBuilderTemplate[];

  contacts:
    CampaignBuilderContact[];

  branchName: string;

  excludedCount: number;

  createAction: (
    previousState:
      CampaignActionState,
    formData: FormData
  ) =>
    Promise<CampaignActionState>;
};

type Stage =
  | "configure"
  | "review";

// =====================================================
// DÍAS
// =====================================================

const WEEKDAYS = [
  {
    value: 1,
    label: "Lun",
  },
  {
    value: 2,
    label: "Mar",
  },
  {
    value: 3,
    label: "Mié",
  },
  {
    value: 4,
    label: "Jue",
  },
  {
    value: 5,
    label: "Vie",
  },
  {
    value: 6,
    label: "Sáb",
  },
  {
    value: 7,
    label: "Dom",
  },
];

// =====================================================
// SALUDOS VARIADOS DEFAULT
// =====================================================

const DEFAULT_VARIANTS = `Hola {{nombre}}, ¿cómo estás?
Muy buenas tardes {{nombre}}, ¿cómo estás?
Hola {{nombre}}, espero que estés muy bien.
¡Buenas {{nombre}}! ¿Cómo va?`;

// =====================================================
// COMPONENTE
// =====================================================

export default function CampaignBuilder({
  templates,
  contacts,
  branchName,
  excludedCount,
  createAction,
}: CampaignBuilderProps) {
  const [
    stage,
    setStage,
  ] =
    useState<Stage>(
      "configure"
    );

  const [
    campaignName,
    setCampaignName,
  ] =
    useState("");

  const [
    templateId,
    setTemplateId,
  ] =
    useState(
      templates[0]?.id ??
        ""
    );

  const [
    selectedIds,
    setSelectedIds,
  ] =
    useState<Set<string>>(
      new Set(
        contacts.map(
          (contact) =>
            contact.id
        )
      )
    );

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    greetingMode,
    setGreetingMode,
  ] =
    useState<
      "automatic" |
      "varied" |
      "fixed"
    >(
      "automatic"
    );

  const [
    fixedGreeting,
    setFixedGreeting,
  ] =
    useState(
      "Hola {{nombre}}, ¿cómo estás?"
    );

  const [
    greetingVariants,
    setGreetingVariants,
  ] =
    useState(
      DEFAULT_VARIANTS
    );

  const [
    startMode,
    setStartMode,
  ] =
    useState<
      "now" |
      "scheduled"
    >(
      "now"
    );

  const [
    scheduledLocal,
    setScheduledLocal,
  ] =
    useState(
      getDefaultDateTimeLocal()
    );

  const [
    windowStart,
    setWindowStart,
  ] =
    useState(
      "09:00"
    );

  const [
    windowEnd,
    setWindowEnd,
  ] =
    useState(
      "20:00"
    );

  const [
    maxPerHour,
    setMaxPerHour,
  ] =
    useState(20);

  const [
    maxPerDay,
    setMaxPerDay,
  ] =
    useState(60);

  const [
    continueNextDay,
    setContinueNextDay,
  ] =
    useState(true);

  const [
    allowedWeekdays,
    setAllowedWeekdays,
  ] =
    useState<number[]>(
      [
        1,
        2,
        3,
        4,
        5,
        6,
      ]
    );

  const [
    reviewRecipients,
    setReviewRecipients,
  ] =
    useState<
      BuiltCampaignRecipient[]
    >([]);

  const [
    reviewGreetingConfig,
    setReviewGreetingConfig,
  ] =
    useState<
      CampaignGreetingConfig | null
    >(null);

  const [
    reviewScheduleConfig,
    setReviewScheduleConfig,
  ] =
    useState<
      CampaignScheduleConfig | null
    >(null);

  const [
    localError,
    setLocalError,
  ] =
    useState<string | null>(
      null
    );

  const [
    actionState,
    formAction,
  ] =
    useActionState(
      createAction,
      {
        error: null,
      }
    );

  // ===================================================
  // PLANTILLA
  // ===================================================

  const selectedTemplate =
    useMemo(
      () =>
        templates.find(
          (template) =>
            template.id ===
            templateId
        ) ?? null,
      [
        templates,
        templateId,
      ]
    );

  // ===================================================
  // CONTACTOS VISIBLES
  // ===================================================

  const visibleContacts =
    useMemo(() => {
      const term =
        search
          .trim()
          .toLocaleLowerCase(
            "es-AR"
          );

      if (!term) {
        return contacts;
      }

      return contacts.filter(
        (contact) => {
          const text =
            [
              contact.firstName,
              contact.lastName,
              contact.phone,
              contact.email,
            ]
              .join(" ")
              .toLocaleLowerCase(
                "es-AR"
              );

          return text.includes(
            term
          );
        }
      );
    }, [
      contacts,
      search,
    ]);

  // ===================================================
  // SELECCIÓN
  // ===================================================

  function toggleContact(
    id: string
  ) {
    setSelectedIds(
      (current) => {
        const next =
          new Set(
            current
          );

        if (
          next.has(id)
        ) {
          next.delete(id);
        } else {
          next.add(id);
        }

        return next;
      }
    );
  }

  function selectAll() {
    setSelectedIds(
      new Set(
        contacts.map(
          (contact) =>
            contact.id
        )
      )
    );
  }

  function clearAll() {
    setSelectedIds(
      new Set()
    );
  }

  // ===================================================
  // DÍAS
  // ===================================================

  function toggleWeekday(
    value: number
  ) {
    setAllowedWeekdays(
      (current) => {
        if (
          current.includes(
            value
          )
        ) {
          return current.filter(
            (day) =>
              day !==
              value
          );
        }

        return [
          ...current,
          value,
        ].sort();
      }
    );
  }

  // ===================================================
  // REVISAR
  // ===================================================

  function handleReview() {
    setLocalError(
      null
    );

    try {
      if (
        !campaignName.trim()
      ) {
        throw new Error(
          "Escribí un nombre para la campaña."
        );
      }

      if (
        !selectedTemplate
      ) {
        throw new Error(
          "Seleccioná una plantilla."
        );
      }

      if (
        selectedIds.size ===
        0
      ) {
        throw new Error(
          "Seleccioná al menos un destinatario."
        );
      }

      if (
        allowedWeekdays.length ===
        0
      ) {
        throw new Error(
          "Seleccioná al menos un día habilitado."
        );
      }

      let startAt:
        string;

      if (
        startMode === "now"
      ) {
        startAt =
          new Date().toISOString();
      } else {
        if (
          !scheduledLocal
        ) {
          throw new Error(
            "Seleccioná la fecha y hora de inicio."
          );
        }

        const scheduledDate =
          new Date(
            scheduledLocal
          );

        if (
          Number.isNaN(
            scheduledDate.getTime()
          )
        ) {
          throw new Error(
            "La fecha programada no es válida."
          );
        }

        startAt =
          scheduledDate.toISOString();
      }

      const greetingConfig:
        CampaignGreetingConfig =
          {
            mode:
              greetingMode,

            fixed:
              fixedGreeting.trim(),

            variants:
              greetingVariants
                .split("\n")
                .map(
                  (value) =>
                    value.trim()
                )
                .filter(Boolean),
          };

      const scheduleConfig:
        CampaignScheduleConfig =
          {
            timezone:
              "America/Argentina/Buenos_Aires",

            startAt,

            windowStart,
            windowEnd,

            maxPerHour:
              Math.max(
                1,
                Math.floor(
                  maxPerHour
                )
              ),

            maxPerDay:
              Math.max(
                1,
                Math.floor(
                  maxPerDay
                )
              ),

            continueNextDay,

            allowedWeekdays,
          };

      const selectedContacts =
        contacts.filter(
          (contact) =>
            selectedIds.has(
              contact.id
            )
        );

      const built =
        buildCampaignRecipients({
          contacts:
            selectedContacts,

          templateBody:
            selectedTemplate.body,

          greetingConfig,

          scheduleConfig,

          branchName,
        });

      setReviewRecipients(
        built
      );

      setReviewGreetingConfig(
        greetingConfig
      );

      setReviewScheduleConfig(
        scheduleConfig
      );

      setStage(
        "review"
      );

      window.scrollTo({
        top: 0,
        behavior:
          "smooth",
      });
    } catch (error) {
      setLocalError(
        getErrorMessage(
          error
        )
      );
    }
  }

  // ===================================================
  // RESUMEN
  // ===================================================

  const uniqueDays =
    useMemo(() => {
      return new Set(
        reviewRecipients.map(
          (recipient) =>
            formatDayKey(
              recipient.scheduledFor
            )
        )
      ).size;
    }, [
      reviewRecipients,
    ]);

  // ===================================================
  // REVIEW
  // ===================================================

  if (
    stage === "review" &&
    selectedTemplate &&
    reviewGreetingConfig &&
    reviewScheduleConfig
  ) {
    return (
      <section className="space-y-7">
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.05] p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Revisión de campaña
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            {campaignName}
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            Todavía no se enviará ningún
            mensaje. Estás revisando cómo
            quedará preparado el lote.
          </p>
        </div>

        {(localError ||
          actionState.error) && (
          <ErrorBox
            text={
              localError ||
              actionState.error ||
              ""
            }
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Destinatarios"
            value={
              reviewRecipients.length
            }
            text="Mensajes preparados"
          />

          <MetricCard
            title="Máximo / hora"
            value={
              reviewScheduleConfig.maxPerHour
            }
            text="Ritmo configurado"
          />

          <MetricCard
            title="Máximo / día"
            value={
              reviewScheduleConfig.maxPerDay
            }
            text="Límite diario"
          />

          <MetricCard
            title="Días estimados"
            value={
              uniqueDays
            }
            text="Según programación"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SummaryCard
            title="Plantilla"
            value={
              selectedTemplate.name
            }
          />

          <SummaryCard
            title="Saludo"
            value={
              greetingModeLabel(
                reviewGreetingConfig.mode
              )
            }
          />

          <SummaryCard
            title="Franja horaria"
            value={`${reviewScheduleConfig.windowStart} a ${reviewScheduleConfig.windowEnd}`}
          />

          <SummaryCard
            title="Primer mensaje"
            value={
              reviewRecipients[0]
                ? formatSchedule(
                    reviewRecipients[0]
                      .scheduledFor
                  )
                : "—"
            }
          />
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/10 p-6">
            <h3 className="text-xl font-semibold">
              Mensajes personalizados
            </h3>

            <p className="mt-1 text-sm text-slate-400">
              Revisá el texto y el horario
              previsto para cada persona.
            </p>
          </div>

          <div className="max-h-[650px] divide-y divide-white/5 overflow-auto">
            {reviewRecipients.map(
              (
                recipient,
                index
              ) => (
                <div
                  key={
                    recipient.contactId
                  }
                  className="grid gap-5 p-5 lg:grid-cols-[220px_1fr]"
                >
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-600">
                      #{index + 1}
                    </p>

                    <p className="mt-2 font-semibold text-slate-200">
                      {
                        recipient.fullName
                      }
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {
                        recipient.phone
                      }
                    </p>

                    <p className="mt-3 text-xs font-medium text-emerald-400">
                      {formatSchedule(
                        recipient.scheduledFor
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#005c4b] p-4">
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white">
                      {
                        recipient.message
                      }
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5 text-sm text-amber-100/80">
          Crear la campaña solamente
          preparará y programará los
          destinatarios. El módulo de envío
          será una capa separada y deberá
          validar también la elegibilidad y
          consentimiento antes de enviar.
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => {
              setStage(
                "configure"
              );

              window.scrollTo({
                top: 0,
                behavior:
                  "smooth",
              });
            }}
            className="rounded-xl border border-white/10 px-5 py-3 font-medium text-slate-300 transition hover:bg-white/5"
          >
            ← Volver a configurar
          </button>

          <form
            action={
              formAction
            }
          >
            <input
              type="hidden"
              name="name"
              value={
                campaignName
              }
            />

            <input
              type="hidden"
              name="template_id"
              value={
                templateId
              }
            />

            <input
              type="hidden"
              name="contact_ids"
              value={JSON.stringify(
                Array.from(
                  selectedIds
                )
              )}
            />

            <input
              type="hidden"
              name="greeting_config"
              value={JSON.stringify(
                reviewGreetingConfig
              )}
            />

            <input
              type="hidden"
              name="schedule_config"
              value={JSON.stringify(
                reviewScheduleConfig
              )}
            />

            <CreateCampaignButton
              count={
                reviewRecipients.length
              }
            />
          </form>
        </div>
      </section>
    );
  }

  // ===================================================
  // CONFIGURACIÓN
  // ===================================================

  return (
    <section className="space-y-7">
      {(localError ||
        actionState.error) && (
        <ErrorBox
          text={
            localError ||
            actionState.error ||
            ""
          }
        />
      )}

      {/* DATOS GENERALES */}

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          1 · Campaña
        </p>

        <h2 className="mt-2 text-2xl font-bold">
          Configuración general
        </h2>

        <div className="mt-7 grid gap-5 md:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-name"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              Nombre de campaña
            </label>

            <input
              id="campaign-name"
              type="text"
              value={
                campaignName
              }
              onChange={(event) =>
                setCampaignName(
                  event.target.value
                )
              }
              placeholder="Ej. Invitación Octubre"
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label
              htmlFor="template"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              Plantilla
            </label>

            <select
              id="template"
              value={
                templateId
              }
              onChange={(event) =>
                setTemplateId(
                  event.target.value
                )
              }
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            >
              {templates.map(
                (template) => (
                  <option
                    key={
                      template.id
                    }
                    value={
                      template.id
                    }
                  >
                    {
                      template.name
                    }
                  </option>
                )
              )}
            </select>
          </div>
        </div>

        {selectedTemplate && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-600">
              Plantilla seleccionada
            </p>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-400">
              {
                selectedTemplate.body
              }
            </p>
          </div>
        )}
      </div>

      {/* DESTINATARIOS */}

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              2 · Destinatarios
            </p>

            <h2 className="mt-2 text-2xl font-bold">
              Elegir contactos
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              Los contactos marcados como
              “No contactar” ya fueron
              excluidos.
            </p>
          </div>

          <div className="text-right">
            <p className="text-3xl font-bold">
              {selectedIds.size}
            </p>

            <p className="text-xs text-slate-500">
              seleccionados
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Buscar nombre, teléfono o email..."
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
          />

          <button
            type="button"
            onClick={
              selectAll
            }
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
          >
            Seleccionar todos
          </button>

          <button
            type="button"
            onClick={
              clearAll
            }
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
          >
            Limpiar
          </button>
        </div>

        {excludedCount > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-amber-100/70">
            {excludedCount} contacto
            {excludedCount === 1
              ? ""
              : "s"}{" "}
            marcado
            {excludedCount === 1
              ? ""
              : "s"}{" "}
            como “No contactar” fue
            excluido automáticamente.
          </div>
        )}

        <div className="mt-5 max-h-[430px] overflow-auto rounded-2xl border border-white/10">
          {visibleContacts.map(
            (contact) => {
              const checked =
                selectedIds.has(
                  contact.id
                );

              const fullName =
                [
                  contact.firstName,
                  contact.lastName,
                ]
                  .filter(Boolean)
                  .join(" ") ||
                "Sin nombre";

              return (
                <label
                  key={
                    contact.id
                  }
                  className="flex cursor-pointer items-center gap-4 border-b border-white/5 p-4 transition last:border-b-0 hover:bg-white/[0.025]"
                >
                  <input
                    type="checkbox"
                    checked={
                      checked
                    }
                    onChange={() =>
                      toggleContact(
                        contact.id
                      )
                    }
                    className="h-4 w-4 accent-emerald-500"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-200">
                      {
                        fullName
                      }
                    </p>

                    <p className="mt-1 truncate text-xs text-slate-500">
                      {contact.phone}
                      {contact.email
                        ? ` · ${contact.email}`
                        : ""}
                    </p>
                  </div>
                </label>
              );
            }
          )}
        </div>
      </div>

      {/* SALUDOS */}

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          3 · Personalización
        </p>

        <h2 className="mt-2 text-2xl font-bold">
          Saludo
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Tvameva puede adaptar el saludo
          manteniendo el resto de la
          plantilla.
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          <GreetingOption
            active={
              greetingMode ===
              "automatic"
            }
            title="Automático"
            text="Usa variantes según el horario programado."
            onClick={() =>
              setGreetingMode(
                "automatic"
              )
            }
          />

          <GreetingOption
            active={
              greetingMode ===
              "varied"
            }
            title="Variado"
            text="Distribuye frases que vos previamente aprobaste."
            onClick={() =>
              setGreetingMode(
                "varied"
              )
            }
          />

          <GreetingOption
            active={
              greetingMode ===
              "fixed"
            }
            title="Fijo"
            text="Utiliza exactamente el mismo saludo."
            onClick={() =>
              setGreetingMode(
                "fixed"
              )
            }
          />
        </div>

        {greetingMode ===
          "varied" && (
          <div className="mt-6">
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Una variante por línea
            </label>

            <textarea
              rows={7}
              value={
                greetingVariants
              }
              onChange={(event) =>
                setGreetingVariants(
                  event.target.value
                )
              }
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-4 text-sm leading-7 text-white outline-none focus:border-emerald-400"
            />

            <p className="mt-2 text-xs text-slate-500">
              Podés usar{" "}
              {"{{nombre}}"} dentro del
              saludo.
            </p>
          </div>
        )}

        {greetingMode ===
          "fixed" && (
          <div className="mt-6">
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Saludo fijo
            </label>

            <input
              type="text"
              value={
                fixedGreeting
              }
              onChange={(event) =>
                setFixedGreeting(
                  event.target.value
                )
              }
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            />
          </div>
        )}

        <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/50 p-4 text-xs leading-5 text-slate-500">
          Si tus saludos ya incluyen el
          nombre, lo más limpio es que la
          plantilla comience simplemente
          con{" "}
          <span className="font-mono text-emerald-300">
            {"{{saludo}}"}
          </span>
          .
        </div>
      </div>

      {/* PROGRAMACIÓN */}

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          4 · Programación
        </p>

        <h2 className="mt-2 text-2xl font-bold">
          Frecuencia y períodos
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Definí cuándo puede procesarse el
          lote y cómo distribuirlo en el
          tiempo.
        </p>

        <div className="mt-7 grid gap-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Inicio
            </label>

            <select
              value={
                startMode
              }
              onChange={(event) =>
                setStartMode(
                  event.target
                    .value as
                    | "now"
                    | "scheduled"
                )
              }
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            >
              <option value="now">
                Desde ahora
              </option>

              <option value="scheduled">
                Programar fecha y hora
              </option>
            </select>
          </div>

          {startMode ===
            "scheduled" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Fecha y hora
              </label>

              <input
                type="datetime-local"
                value={
                  scheduledLocal
                }
                onChange={(event) =>
                  setScheduledLocal(
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Enviar desde
            </label>

            <input
              type="time"
              value={
                windowStart
              }
              onChange={(event) =>
                setWindowStart(
                  event.target.value
                )
              }
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Hasta
            </label>

            <input
              type="time"
              value={
                windowEnd
              }
              onChange={(event) =>
                setWindowEnd(
                  event.target.value
                )
              }
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
            />
          </div>

          <NumberField
            label="Máximo por hora"
            value={
              maxPerHour
            }
            min={1}
            max={500}
            onChange={
              setMaxPerHour
            }
          />

          <NumberField
            label="Máximo por día"
            value={
              maxPerDay
            }
            min={1}
            max={10000}
            onChange={
              setMaxPerDay
            }
          />
        </div>

        <div className="mt-7">
          <p className="mb-3 text-sm font-medium text-slate-300">
            Días habilitados
          </p>

          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(
              (weekday) => {
                const active =
                  allowedWeekdays.includes(
                    weekday.value
                  );

                return (
                  <button
                    key={
                      weekday.value
                    }
                    type="button"
                    onClick={() =>
                      toggleWeekday(
                        weekday.value
                      )
                    }
                    className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                      active
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-white/10 text-slate-500 hover:bg-white/5"
                    }`}
                  >
                    {
                      weekday.label
                    }
                  </button>
                );
              }
            )}
          </div>
        </div>

        <label className="mt-7 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
          <input
            type="checkbox"
            checked={
              continueNextDay
            }
            onChange={(event) =>
              setContinueNextDay(
                event.target.checked
              )
            }
            className="mt-1 h-4 w-4 accent-emerald-500"
          />

          <div>
            <p className="font-medium text-slate-200">
              Continuar el lote en el
              siguiente día habilitado
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Si se alcanza el límite diario
              o termina la franja horaria,
              Tvameva continúa más adelante.
            </p>
          </div>
        </label>
      </div>

      {/* REVISAR */}

      <div className="flex flex-col justify-between gap-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-7 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-lg font-semibold">
            Listo para revisar
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Tvameva generará cada mensaje y
            su horario antes de guardar la
            campaña.
          </p>
        </div>

        <button
          type="button"
          onClick={
            handleReview
          }
          disabled={
            selectedIds.size ===
              0 ||
            !templateId
          }
          className="rounded-xl bg-emerald-500 px-7 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Revisar lote
        </button>
      </div>
    </section>
  );
}

// =====================================================
// SALUDO OPTION
// =====================================================

function GreetingOption({
  active,
  title,
  text,
  onClick,
}: {
  active: boolean;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-5 text-left transition ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-white/10 bg-slate-900/40 hover:bg-white/[0.04]"
      }`}
    >
      <p
        className={
          active
            ? "font-semibold text-emerald-300"
            : "font-semibold text-slate-200"
        }
      >
        {title}
      </p>

      <p className="mt-2 text-sm leading-5 text-slate-500">
        {text}
      </p>
    </button>
  );
}

// =====================================================
// NUMBER FIELD
// =====================================================

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (
    value: number
  ) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </label>

      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) =>
          onChange(
            Number(
              event.target.value
            )
          )
        }
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
      />
    </div>
  );
}

// =====================================================
// MÉTRICA
// =====================================================

function MetricCard({
  title,
  value,
  text,
}: {
  title: string;
  value: number;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-400">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {text}
      </p>
    </div>
  );
}

// =====================================================
// RESUMEN
// =====================================================

function SummaryCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs uppercase tracking-wider text-slate-600">
        {title}
      </p>

      <p className="mt-2 font-medium text-slate-200">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// ERROR
// =====================================================

function ErrorBox({
  text,
}: {
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
      {text}
    </div>
  );
}

// =====================================================
// SUBMIT
// =====================================================

function CreateCampaignButton({
  count,
}: {
  count: number;
}) {
  const {
    pending,
  } =
    useFormStatus();

  return (
    <button
      type="submit"
      disabled={
        pending
      }
      className="rounded-xl bg-emerald-500 px-7 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-50"
    >
      {pending
        ? "Creando campaña..."
        : `Crear campaña · ${count} destinatarios`}
    </button>
  );
}

// =====================================================
// LABEL SALUDO
// =====================================================

function greetingModeLabel(
  mode:
    CampaignGreetingConfig["mode"]
) {
  if (
    mode === "automatic"
  ) {
    return "Automático según horario";
  }

  if (
    mode === "varied"
  ) {
    return "Variado";
  }

  return "Fijo";
}

// =====================================================
// FECHAS
// =====================================================

function formatSchedule(
  value: string
) {
  const date =
    new Date(value);

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      timeZone:
        "America/Argentina/Buenos_Aires",

      weekday:
        "short",

      day:
        "2-digit",

      month:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",
    }
  ).format(date);
}

function formatDayKey(
  value: string
) {
  const date =
    new Date(value);

  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "America/Argentina/Buenos_Aires",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",
    }
  ).format(date);
}

// =====================================================
// DATETIME LOCAL
// =====================================================

function getDefaultDateTimeLocal() {
  const date =
    new Date(
      Date.now() +
        30 *
          60 *
          1000
    );

  const local =
    new Date(
      date.getTime() -
        date.getTimezoneOffset() *
          60 *
          1000
    );

  return local
    .toISOString()
    .slice(
      0,
      16
    );
}

// =====================================================
// ERROR
// =====================================================

function getErrorMessage(
  error: unknown
) {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return "Ocurrió un error inesperado.";
}