import Link from "next/link";
import { Suspense } from "react";

import {
  redirect,
} from "next/navigation";

import {
  revalidatePath,
} from "next/cache";

import { createClient } from "@/lib/supabase/server";

import TemplateEditor from "@/components/template-editor";

// =====================================================
// PÁGINA
// =====================================================

export default function NewTemplatePage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <NewTemplateContent />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function NewTemplateContent() {
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
  // CONTACTO REAL PARA PREVIEW
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
  // CREAR
  // ===================================================

  async function createTemplate(
    formData: FormData
  ) {
    "use server";

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
      .insert({
        organization_id:
          membership.organization_id,

        name,

        body,

        created_by:
          user.id,

        updated_at:
          new Date().toISOString(),
      });

    if (error) {
      console.error(
        "Error creando plantilla:",
        error
      );

      throw new Error(
        "No se pudo guardar la plantilla."
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
        <TemplateEditor
          mode="create"
          previewData={
            previewData
          }
          saveAction={
            createTemplate
          }
        />
      </div>
    </main>
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
          Preparando editor...
        </p>
      </div>
    </main>
  );
}