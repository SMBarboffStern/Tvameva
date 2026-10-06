import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// TIPOS
// =====================================================

type TemplateRow = {
  id: string;
  name: string;
  body: string;

  created_at: string;
  updated_at: string;
};

// =====================================================
// PÁGINA
// =====================================================

export default function TemplatesPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <TemplatesContent />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function TemplatesContent() {
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
    error: membershipError,
  } = await supabase
    .from("memberships")
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

  if (
    membershipError ||
    !membership
  ) {
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
  // PLANTILLAS
  // ===================================================

  const {
    data,
    error,
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
      "organization_id",
      membership.organization_id
    )
    .order(
      "updated_at",
      {
        ascending: false,
      }
    );

  if (error) {
    console.error(
      "Error cargando plantillas:",
      error
    );
  }

  const templates =
    (data ?? []) as TemplateRow[];

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
              Mensajes
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              Plantillas
            </h2>

            <p className="mt-2 max-w-2xl text-slate-400">
              Creá mensajes reutilizables y
              personalizados para tus
              campañas.
            </p>
          </div>

          <Link
            href="/protected/plantillas/nueva"
            className="rounded-xl bg-emerald-500 px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            + Nueva plantilla
          </Link>
        </div>

        {/* MÉTRICA */}

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm text-slate-400">
            Plantillas guardadas
          </p>

          <p className="mt-2 text-4xl font-bold">
            {templates.length}
          </p>
        </div>

        {/* VARIABLES */}

        <div className="mt-6 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6">
          <p className="font-medium text-emerald-300">
            Personalización automática
          </p>

          <p className="mt-2 text-sm text-slate-400">
            Podés utilizar variables como{" "}
            <span className="font-mono text-emerald-300">
              {"{{nombre}}"}
            </span>
            ,{" "}
            <span className="font-mono text-emerald-300">
              {"{{curso}}"}
            </span>{" "}
            y{" "}
            <span className="font-mono text-emerald-300">
              {"{{saludo}}"}
            </span>
            .
          </p>
        </div>

        {/* LISTADO */}

        {templates.length > 0 ? (
          <div className="mt-7 grid gap-5 lg:grid-cols-2">
            {templates.map(
              (template) => (
                <Link
                  key={
                    template.id
                  }
                  href={`/protected/plantillas/${template.id}`}
                  className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"
                >
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                        Plantilla
                      </p>

                      <h3 className="mt-2 text-xl font-semibold text-white">
                        {template.name}
                      </h3>
                    </div>

                    <span className="text-emerald-400 opacity-0 transition group-hover:opacity-100">
                      →
                    </span>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/5 bg-slate-900/50 p-4">
                    <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-slate-400">
                      {template.body}
                    </p>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-4 text-xs text-slate-600">
                    <span>
                      Actualizada{" "}
                      {formatDate(
                        template.updated_at
                      )}
                    </span>

                    <span className="font-medium text-emerald-400">
                      Editar →
                    </span>
                  </div>
                </Link>
              )
            )}
          </div>
        ) : (
          <div className="mt-7 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
            <div className="text-4xl">
              💬
            </div>

            <h3 className="mt-5 text-xl font-semibold">
              Todavía no hay plantillas
            </h3>

            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
              Creá tu primera plantilla
              para empezar a preparar las
              futuras campañas.
            </p>

            <Link
              href="/protected/plantillas/nueva"
              className="mt-6 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Crear primera plantilla
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

// =====================================================
// FECHA
// =====================================================

function formatDate(
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
          Cargando plantillas...
        </p>
      </div>
    </main>
  );
}