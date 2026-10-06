import { randomUUID } from "crypto";

import Link from "next/link";
import { Suspense } from "react";

import {
  redirect,
} from "next/navigation";

import {
  revalidatePath,
} from "next/cache";

import { createClient } from "@/lib/supabase/server";

import CampaignBuilder from "@/components/campaign-builder";

import type {
  CampaignActionState,
} from "@/components/campaign-builder";

import {
  buildCampaignRecipients,
} from "@/lib/campaigns/engine";

import type {
  CampaignContact,
  CampaignGreetingConfig,
  CampaignScheduleConfig,
} from "@/lib/campaigns/engine";

// =====================================================
// PÁGINA
// =====================================================

export default function NewCampaignPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <NewCampaignContent />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function NewCampaignContent() {
  const supabase =
    await createClient();

  // ===================================================
  // USUARIO
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
  // MEMBRESÍA
  // ===================================================

  const {
    data: membership,
  } = await supabase
    .from("memberships")
    .select(
      `
        organization_id,
        branch_id
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
  // CLAVE DE IDEMPOTENCIA
  // ===================================================

  /*
   * Esta clave pertenece a ESTA instancia
   * del formulario.
   *
   * Si el usuario hace doble clic,
   * reintenta la petición o el navegador
   * repite el POST, la misma clave evita
   * crear dos campañas.
   */

  const idempotencyKey =
    randomUUID();

  // ===================================================
  // ORGANIZACIÓN
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
  // SEDE
  // ===================================================

  let branchName = "";

  if (
    membership.branch_id
  ) {
    const {
      data: branch,
    } = await supabase
      .from("branches")
      .select("name")
      .eq(
        "id",
        membership.branch_id
      )
      .maybeSingle();

    branchName =
      branch?.name ??
      "";
  }

  // ===================================================
  // PLANTILLAS
  // ===================================================

  const {
    data: templates,
  } = await supabase
    .from("templates")
    .select(
      `
        id,
        name,
        body
      `
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .order(
      "updated_at",
      {
        ascending: false,
      }
    );

  // ===================================================
  // CONTACTOS ACTIVOS
  // ===================================================

  const {
    data: contacts,
  } = await supabase
    .from("contacts")
    .select(
      `
        id,
        first_name,
        last_name,
        phone_e164,
        email,
        source_data,
        opted_in
      `
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .eq(
      "status",
      "active"
    )
    .order(
      "last_name",
      {
        ascending: true,
      }
    );

  // ===================================================
  // NO CONTACTAR
  // ===================================================

  const {
    count: excludedCount,
  } = await supabase
    .from("contacts")
    .select(
      "id",
      {
        count: "exact",
        head: true,
      }
    )
    .eq(
      "organization_id",
      membership.organization_id
    )
    .eq(
      "status",
      "unsubscribed"
    );

  // ===================================================
  // FORMATEAR CONTACTOS
  // ===================================================

  const campaignContacts:
    CampaignContact[] =
      (contacts ?? []).map(
        (contact) => ({
          id:
            contact.id,

          firstName:
            contact.first_name ??
            "",

          lastName:
            contact.last_name ??
            "",

          phone:
            contact.phone_e164,

          email:
            contact.email ??
            "",

          sourceData:
            contact.source_data,

          optedIn:
            contact.opted_in ===
            true,
        })
      );

  // ===================================================
  // CREAR CAMPAÑA
  // ===================================================

  async function createCampaign(
    previousState:
      CampaignActionState,
    formData: FormData
  ): Promise<CampaignActionState> {
    "use server";

    void previousState;

    const supabase =
      await createClient();

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      redirect(
        "/auth/login"
      );
    }

    let campaignToOpen:
      string | null =
        null;

    try {
      // ===============================================
      // MEMBRESÍA
      // ===============================================

      const {
        data: membership,
      } = await supabase
        .from("memberships")
        .select(
          `
            organization_id,
            branch_id
          `
        )
        .eq(
          "user_id",
          user.id
        )
        .limit(1)
        .maybeSingle();

      if (!membership) {
        return {
          error:
            "No se pudo identificar tu organización.",
        };
      }

      // ===============================================
      // DATOS PRINCIPALES
      // ===============================================

      const name =
        safeText(
          formData.get(
            "name"
          ),
          200
        );

      const templateId =
        safeText(
          formData.get(
            "template_id"
          ),
          100
        );

      if (
        !name ||
        !templateId
      ) {
        return {
          error:
            "Falta el nombre o la plantilla de la campaña.",
        };
      }

      const contactIds =
        parseStringArray(
          formData.get(
            "contact_ids"
          )
        );

      if (
        contactIds.length ===
        0
      ) {
        return {
          error:
            "La campaña no tiene destinatarios.",
        };
      }

      if (
        contactIds.length >
        20000
      ) {
        return {
          error:
            "El lote supera el máximo permitido para esta versión.",
        };
      }

      const greetingConfig =
        parseGreetingConfig(
          formData.get(
            "greeting_config"
          )
        );

      const scheduleConfig =
        parseScheduleConfig(
          formData.get(
            "schedule_config"
          )
        );

      // ===============================================
      // VALIDAR PLANTILLA
      // ===============================================

      const {
        data: template,
        error:
          templateError,
      } = await supabase
        .from("templates")
        .select(
          `
            id,
            body
          `
        )
        .eq(
          "id",
          templateId
        )
        .eq(
          "organization_id",
          membership.organization_id
        )
        .maybeSingle();

      if (
        templateError ||
        !template
      ) {
        return {
          error:
            "La plantilla seleccionada no existe.",
        };
      }

      // ===============================================
      // CONTACTOS AUTORIZADOS
      // ===============================================

      const uniqueContactIds =
        Array.from(
          new Set(
            contactIds
          )
        );

      const {
        data:
          authorizedContacts,

        error:
          contactsError,
      } = await supabase
        .from("contacts")
        .select(
          `
            id,
            first_name,
            last_name,
            phone_e164,
            email,
            source_data,
            opted_in,
            status
          `
        )
        .eq(
          "organization_id",
          membership.organization_id
        )
        .eq(
          "status",
          "active"
        )
        .in(
          "id",
          uniqueContactIds
        );

      if (
        contactsError
      ) {
        console.error(
          "Error validando contactos:",
          contactsError
        );

        return {
          error:
            "No se pudieron validar los destinatarios.",
        };
      }

      if (
        !authorizedContacts ||
        authorizedContacts.length ===
          0
      ) {
        return {
          error:
            "No quedan destinatarios activos para esta campaña.",
        };
      }

      // ===============================================
      // SEDE
      // ===============================================

      let branchName = "";

      if (
        membership.branch_id
      ) {
        const {
          data: branch,
        } = await supabase
          .from("branches")
          .select("name")
          .eq(
            "id",
            membership.branch_id
          )
          .maybeSingle();

        branchName =
          branch?.name ??
          "";
      }

      // ===============================================
      // CONTACTOS PARA EL ENGINE
      // ===============================================

      const serverContacts:
        CampaignContact[] =
          authorizedContacts.map(
            (contact) => ({
              id:
                contact.id,

              firstName:
                contact.first_name ??
                "",

              lastName:
                contact.last_name ??
                "",

              phone:
                contact.phone_e164,

              email:
                contact.email ??
                "",

              sourceData:
                contact.source_data,

              optedIn:
                contact.opted_in ===
                true,
            })
          );

      // ===============================================
      // CAMPAIGN ENGINE
      // ===============================================

      const recipients =
        buildCampaignRecipients({
          contacts:
            serverContacts,

          templateBody:
            template.body,

          greetingConfig,

          scheduleConfig,

          branchName,
        });

      if (
        recipients.length ===
        0
      ) {
        return {
          error:
            "No se generaron destinatarios.",
        };
      }

      // ===============================================
      // COMPROBAR IDEMPOTENCIA ANTES DEL INSERT
      // ===============================================

      const {
        data:
          existingCampaign,
      } = await supabase
        .from("campaigns")
        .select("id")
        .eq(
          "organization_id",
          membership.organization_id
        )
        .eq(
          "idempotency_key",
          idempotencyKey
        )
        .maybeSingle();

      if (
        existingCampaign
      ) {
        campaignToOpen =
          existingCampaign.id;
      } else {
        // =============================================
        // CREAR CAMPAÑA
        // =============================================

        const firstScheduled =
          recipients[0]
            .scheduledFor;

        const {
          data: campaign,
          error:
            campaignError,
        } = await supabase
          .from("campaigns")
          .insert({
            organization_id:
              membership.organization_id,

            branch_id:
              membership.branch_id,

            template_id:
              templateId,

            name,

            status:
              "ready",

            total_recipients:
              recipients.length,

            sent_count:
              0,

            failed_count:
              0,

            created_by:
              user.id,

            greeting_config:
              greetingConfig,

            schedule_config:
              scheduleConfig,

            scheduled_start_at:
              scheduleConfig.startAt,

            next_run_at:
              firstScheduled,

            last_run_at:
              null,

            idempotency_key:
              idempotencyKey,

            execution_mode:
              "simulation",
          })
          .select(
            "id"
          )
          .single();

        // =============================================
        // POSIBLE DOBLE PETICIÓN
        // =============================================

        if (
          campaignError ||
          !campaign
        ) {
          if (
            campaignError?.code ===
            "23505"
          ) {
            const {
              data:
                duplicateCampaign,
            } = await supabase
              .from("campaigns")
              .select("id")
              .eq(
                "organization_id",
                membership.organization_id
              )
              .eq(
                "idempotency_key",
                idempotencyKey
              )
              .maybeSingle();

            if (
              duplicateCampaign
            ) {
              campaignToOpen =
                duplicateCampaign.id;
            } else {
              return {
                error:
                  "La campaña ya fue procesada, pero no pudimos recuperarla.",
              };
            }
          } else {
            console.error(
              "Error creando campaña:",
              campaignError
            );

            return {
              error:
                "No se pudo crear la campaña.",
            };
          }
        } else {
          // ===========================================
          // DESTINATARIOS
          // ===========================================

          const rows =
            recipients.map(
              (recipient) => ({
                campaign_id:
                  campaign.id,

                contact_id:
                  recipient.contactId,

                rendered_message:
                  recipient.message,

                status:
                  "prepared",

                scheduled_for:
                  recipient.scheduledFor,

                attempt_count:
                  0,

                last_attempt_at:
                  null,

                simulated_at:
                  null,
              })
            );

          const CHUNK_SIZE =
            250;

          for (
            let index = 0;
            index <
            rows.length;
            index +=
              CHUNK_SIZE
          ) {
            const chunk =
              rows.slice(
                index,
                index +
                  CHUNK_SIZE
              );

            const {
              error,
            } = await supabase
              .from(
                "campaign_recipients"
              )
              .insert(
                chunk
              );

            if (error) {
              console.error(
                "Error creando destinatarios:",
                error
              );

              await supabase
                .from(
                  "campaign_recipients"
                )
                .delete()
                .eq(
                  "campaign_id",
                  campaign.id
                );

              await supabase
                .from(
                  "campaigns"
                )
                .delete()
                .eq(
                  "id",
                  campaign.id
                )
                .eq(
                  "organization_id",
                  membership.organization_id
                );

              return {
                error:
                  "No se pudo preparar el lote de destinatarios.",
              };
            }
          }

          campaignToOpen =
            campaign.id;
        }
      }

      revalidatePath(
        "/protected"
      );

      revalidatePath(
        "/protected/campanas"
      );
    } catch (error) {
      console.error(
        "Error general creando campaña:",
        error
      );

      return {
        error:
          getErrorMessage(
            error
          ),
      };
    }

    // =================================================
    // REDIRECT FUERA DEL TRY/CATCH
    // =================================================

    if (
      campaignToOpen
    ) {
      redirect(
        `/protected/campanas/${campaignToOpen}`
      );
    }

    return {
      error:
        "No se pudo completar la creación de la campaña.",
    };
  }

  // ===================================================
  // SIN PLANTILLAS
  // ===================================================

  if (
    !templates ||
    templates.length ===
      0
  ) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <Header
          organizationName={
            organization?.name ??
            "Organización"
          }
        />

        <div className="mx-auto max-w-3xl px-5 py-16">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <h2 className="text-2xl font-bold">
              Primero necesitás una plantilla
            </h2>

            <p className="mt-3 text-slate-400">
              Las campañas utilizan una plantilla
              para generar mensajes personalizados.
            </p>

            <Link
              href="/protected/plantillas/nueva"
              className="mt-7 inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950"
            >
              Crear plantilla
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ===================================================
  // UI
  // ===================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <Header
        organizationName={
          organization?.name ??
          "Organización"
        }
      />

      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-9">
          <p className="text-sm font-medium text-emerald-400">
            Campaign Engine
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            Nueva campaña
          </h1>

          <p className="mt-2 max-w-3xl text-slate-400">
            Elegí destinatarios,
            personalización, frecuencia y
            horarios. Tvameva preparará todo
            el lote antes de guardarlo.
          </p>
        </div>

        <CampaignBuilder
          templates={
            templates
          }
          contacts={
            campaignContacts
          }
          branchName={
            branchName
          }
          excludedCount={
            excludedCount ??
            0
          }
          createAction={
            createCampaign
          }
        />
      </div>
    </main>
  );
}

// =====================================================
// HEADER
// =====================================================

function Header({
  organizationName,
}: {
  organizationName: string;
}) {
  return (
    <header className="border-b border-white/10 bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-5">
        <div>
          <h1 className="text-2xl font-bold">
            Tvameva
          </h1>

          <p className="text-sm text-slate-400">
            {organizationName}
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
  );
}

// =====================================================
// PARSE ARRAY
// =====================================================

function parseStringArray(
  value:
    FormDataEntryValue | null
) {
  try {
    const parsed =
      JSON.parse(
        String(
          value ??
          "[]"
        )
      );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed
      .map(
        (item) =>
          String(
            item
          ).trim()
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

// =====================================================
// GREETING CONFIG
// =====================================================

function parseGreetingConfig(
  value:
    FormDataEntryValue | null
): CampaignGreetingConfig {
  const parsed =
    JSON.parse(
      String(
        value ??
        "{}"
      )
    );

  const mode =
    parsed.mode ===
      "fixed" ||
    parsed.mode ===
      "varied"
      ? parsed.mode
      : "automatic";

  return {
    mode,

    fixed:
      String(
        parsed.fixed ??
        ""
      ).slice(
        0,
        500
      ),

    variants:
      Array.isArray(
        parsed.variants
      )
        ? parsed.variants
            .map(
              (
                item:
                  unknown
              ) =>
                String(
                  item
                ).slice(
                  0,
                  500
                )
            )
            .filter(Boolean)
            .slice(
              0,
              50
            )
        : [],
  };
}

// =====================================================
// SCHEDULE CONFIG
// =====================================================

function parseScheduleConfig(
  value:
    FormDataEntryValue | null
): CampaignScheduleConfig {
  const parsed =
    JSON.parse(
      String(
        value ??
        "{}"
      )
    );

  return {
    timezone:
      "America/Argentina/Buenos_Aires",

    startAt:
      String(
        parsed.startAt ??
        ""
      ),

    windowStart:
      String(
        parsed.windowStart ??
        "09:00"
      ),

    windowEnd:
      String(
        parsed.windowEnd ??
        "20:00"
      ),

    maxPerHour:
      Number(
        parsed.maxPerHour ??
        20
      ),

    maxPerDay:
      Number(
        parsed.maxPerDay ??
        60
      ),

    continueNextDay:
      parsed.continueNextDay !==
      false,

    allowedWeekdays:
      Array.isArray(
        parsed.allowedWeekdays
      )
        ? parsed.allowedWeekdays.map(
            (
              day:
                unknown
            ) =>
              Number(day)
          )
        : [
            1,
            2,
            3,
            4,
            5,
            6,
          ],
  };
}

// =====================================================
// TEXT
// =====================================================

function safeText(
  value:
    FormDataEntryValue | null,
  maxLength: number
) {
  return String(
    value ??
    ""
  )
    .trim()
    .slice(
      0,
      maxLength
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
          Preparando campaña...
        </p>
      </div>
    </main>
  );
}