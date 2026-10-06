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

import TemplateEditor from "@/components/template-editor";

// =====================================================
// TIPOS
// =====================================================

type TemplatePageProps = {
  params: Promise<{
    id: string;
  }>;
};

// =====================================================
// PÁGINA
// =====================================================

export default function TemplatePage({
  params,
}: TemplatePageProps) {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <TemplateContent
        params={params}
      />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function TemplateContent({
  params,
}: TemplatePageProps) {
  const {
    id,
  } = await params;

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
  // PLANTILLA
  // ===================================================

  const {
    data: template,
    error: templateError,
  } = await supabase
    .from("templates")
    .select(
      `
        id,
        name,
        body,
        created_at,
        updated_at
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
    templateError ||
    !template
  ) {
    notFound();
  }

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
  // CONTACTO PARA PREVIEW
  // ===================================================

  const {
    data: sampleContact,
  } = await supabase
    .from("contacts")
    .select(
      `
        first_name,
        last_name,
        source_data
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
    .limit(1)
    .maybeSingle();

  const previewData = {
    nombre:
      sampleContact?.first_name ??
      "María",

    apellido:
      sampleContact?.last_name ??
      "González",

    curso:
      getMappedText(
        sampleContact?.source_data,
        "course"
      ) ||
      "Meditación",

    ciudad:
      getMappedText(
        sampleContact?.source_data,
        "city"
      ) ||
      "Buenos Aires",

    sede:
      branchName ||
      "Villa del Parque",
  };

  // ===================================================
  // ACTUALIZAR
  // ===================================================

  async function updateTemplate(
    formData: FormData
  ) {
    "use server";

    const {
      supabase,
      membership,
    } =
      await getAuthenticatedMembership();

    const name =
      safeText(
        formData.get("name"),
        200
      );

    const body =
      safeText(
        formData.get("body"),
        10000
      );

    if (
      !name ||
      !body
    ) {
      throw new Error(
        "El nombre y el mensaje son obligatorios."
      );
    }

    const {
      error,
    } = await supabase
      .from("templates")
      .update({
        name,
        body,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        id
      )
      .eq(
        "organization_id",
        membership.organization_id
      );

    if (error) {
      console.error(
        "Error actualizando plantilla:",
        error
      );

      throw new Error(
        "No se pudo actualizar la plantilla."
      );
    }

    revalidatePath(
      `/protected/plantillas/${id}`
    );

    revalidatePath(
      "/protected/plantillas"
    );

    redirect(
      `/protected/plantillas/${id}`
    );
  }

  // ===================================================
  // DUPLICAR
  // ===================================================

  async function duplicateTemplate() {
    "use server";

    const {
      supabase,
      membership,
      user,
    } =
      await getAuthenticatedMembership();

    const {
      data: current,
      error:
        currentError,
    } = await supabase
      .from("templates")
      .select(
        `
          name,
          body
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
      currentError ||
      !current
    ) {
      throw new Error(
        "No se encontró la plantilla."
      );
    }

    const {
      data: copy,
      error,
    } = await supabase
      .from("templates")
      .insert({
        organization_id:
          membership.organization_id,

        name:
          `${current.name} (copia)`,

        body:
          current.body,

        created_by:
          user.id,

        updated_at:
          new Date().toISOString(),
      })
      .select("id")
      .single();

    if (
      error ||
      !copy
    ) {
      console.error(
        "Error duplicando plantilla:",
        error
      );

      throw new Error(
        "No se pudo duplicar la plantilla."
      );
    }

    revalidatePath(
      "/protected/plantillas"
    );

    revalidatePath(
      "/protected"
    );

    redirect(
      `/protected/plantillas/${copy.id}`
    );
  }

  // ===================================================
  // ELIMINAR
  // ===================================================

  async function deleteTemplate() {
    "use server";

    const {
      supabase,
      membership,
    } =
      await getAuthenticatedMembership();

    const {
      error,
    } = await supabase
      .from("templates")
      .delete()
      .eq(
        "id",
        id
      )
      .eq(
        "organization_id",
        membership.organization_id
      );

    if (error) {
      console.error(
        "Error eliminando plantilla:",
        error
      );

      throw new Error(
        "No se pudo eliminar la plantilla."
      );
    }

    revalidatePath(
      "/protected/plantillas"
    );

    revalidatePath(
      "/protected"
    );

    redirect(
      "/protected/plantillas"
    );
  }

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
            href="/protected/plantillas"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            ← Volver a plantillas
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-sm text-slate-500">
              Última modificación
            </p>

            <p className="mt-1 font-medium text-slate-300">
              {formatDateTime(
                template.updated_at
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <form
              action={
                duplicateTemplate
              }
            >
              <button
                type="submit"
                className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
              >
                Duplicar plantilla
              </button>
            </form>

            <form
              action={
                deleteTemplate
              }
            >
              <button
                type="submit"
                className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10"
              >
                Eliminar
              </button>
            </form>
          </div>
        </div>

        <TemplateEditor
          mode="edit"
          initialName={
            template.name
          }
          initialBody={
            template.body
          }
          previewData={
            previewData
          }
          saveAction={
            updateTemplate
          }
        />
      </div>
    </main>
  );
}

// =====================================================
// AUTH PARA SERVER ACTIONS
// =====================================================

async function getAuthenticatedMembership() {
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
    throw new Error(
      "No se pudo identificar tu organización."
    );
  }

  return {
    supabase,
    membership,
    user,
  };
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
    Array.isArray(sourceData)
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
    Array.isArray(mapped)
  ) {
    return "";
  }

  const mappedObject =
    mapped as Record<
      string,
      unknown
    >;

  return String(
    mappedObject[key] ??
    ""
  ).trim();
}

// =====================================================
// TEXTO
// =====================================================

function safeText(
  value:
    FormDataEntryValue | null,
  maxLength: number
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}

// =====================================================
// FECHA
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
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(date);
}

// =====================================================
// CARGA
// =====================================================

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-400">
          Tvameva
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Cargando plantilla...
        </p>
      </div>
    </main>
  );
}