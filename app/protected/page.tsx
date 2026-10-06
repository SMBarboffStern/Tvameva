import Link from "next/link";
import { Suspense } from "react";

import {
  redirect,
} from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// PAGE
// =====================================================

export default function ProtectedPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <ProtectedContent />
    </Suspense>
  );
}

// =====================================================
// CONTENT
// =====================================================

async function ProtectedContent() {
  const supabase =
    await createClient();

  // ===================================================
  // USER
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
    data:
      membership,

    error:
      membershipError,
  } = await supabase
    .from(
      "memberships"
    )
    .select(
      `
        organization_id,
        branch_id,
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
    membershipError
  ) {
    console.error(
      "Error obteniendo membresía:",
      membershipError
    );
  }

  // ===================================================
  // ONBOARDING
  // ===================================================

  if (!membership) {
    redirect(
      "/protected/onboarding"
    );
  }

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
  // BRANCH
  // ===================================================

  let branchName =
    "";

  if (
    membership.branch_id
  ) {
    const {
      data:
        branch,
    } = await supabase
      .from(
        "branches"
      )
      .select(
        "name"
      )
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
  // METRICS
  // ===================================================

  const [
    contactsResult,
    templatesResult,
    campaignsResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "contacts"
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
          "organization_id",
          membership.organization_id
        ),

      supabase
        .from(
          "templates"
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
          "organization_id",
          membership.organization_id
        ),

      supabase
        .from(
          "campaigns"
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
          "organization_id",
          membership.organization_id
        ),
    ]);

  const contactsCount =
    contactsResult.count ??
    0;

  const templatesCount =
    templatesResult.count ??
    0;

  const campaignsCount =
    campaignsResult.count ??
    0;

  // ===================================================
  // LABELS
  // ===================================================

  const organizationName =
    organization?.name ??
    "Organización";

  const subtitle =
    branchName
      ? `${organizationName} · ${branchName}`
      : organizationName;

  const role =
    String(
      membership.role ??
      "member"
    ).toUpperCase();

  // ===================================================
  // UI
  // ===================================================

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto min-h-screen max-w-5xl bg-slate-950">
        {/* HEADER */}

        <header className="border-b border-white/10">
          <div className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                Tvameva
              </h1>

              <p className="mt-1 text-sm text-sky-200">
                {subtitle}
              </p>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-sm text-slate-200">
                {user.email}
              </p>

              <p className="mt-1 text-xs font-semibold text-emerald-400">
                {role}
              </p>
            </div>
          </div>
        </header>

        {/* CONTENT */}

        <div className="px-6 py-10">
          <p className="text-sm font-medium text-emerald-400">
            Panel principal
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            Bienvenido a Tvameva 👋
          </h2>

          <p className="mt-2 text-slate-400">
            Desde acá vas a poder
            administrar contactos,
            mensajes y campañas.
          </p>

          {/* MODULES */}

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {/* CONTACTS */}

            <Link
              href="/protected/contactos"
              className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"
            >
              <p className="text-sm text-sky-200">
                Contactos
              </p>

              <p className="mt-3 text-4xl font-bold">
                {contactsCount}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Personas disponibles
              </p>

              <p className="mt-6 text-sm font-medium text-emerald-400 transition group-hover:text-emerald-300">
                Ver módulo →
              </p>
            </Link>

            {/* TEMPLATES */}

            <Link
              href="/protected/plantillas"
              className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"
            >
              <p className="text-sm text-sky-200">
                Plantillas
              </p>

              <p className="mt-3 text-4xl font-bold">
                {templatesCount}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Mensajes guardados
              </p>

              <p className="mt-6 text-sm font-medium text-emerald-400 transition group-hover:text-emerald-300">
                Ver módulo →
              </p>
            </Link>

            {/* CAMPAIGNS */}

            <Link
              href="/protected/campanas"
              className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"
            >
              <p className="text-sm text-sky-200">
                Campañas
              </p>

              <p className="mt-3 text-4xl font-bold">
                {campaignsCount}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Campañas creadas
              </p>

              <p className="mt-6 text-sm font-medium text-emerald-400 transition group-hover:text-emerald-300">
                Ver módulo →
              </p>
            </Link>
          </div>

          {/* ACTIONS */}

          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-7">
            <h3 className="text-xl font-semibold">
              Comenzá a trabajar
            </h3>

            <p className="mt-2 text-sm text-sky-200">
              Administrá tu base de
              contactos, importá una
              planilla o prepará una nueva
              campaña.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/protected/contactos"
                className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
              >
                Ver contactos
              </Link>

              <Link
                href="/protected/importar"
                className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Importar contactos
              </Link>

              <Link
                href="/protected/campanas/nueva"
                className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                + Nueva campaña
              </Link>
            </div>
          </section>

          {/* QUICK LINKS */}

          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            <Link
              href="/protected/plantillas/nueva"
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold text-white">
                + Nueva plantilla
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Crear un nuevo mensaje
                personalizado.
              </p>
            </Link>

            <Link
              href="/protected/campanas"
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold text-white">
                Administrar campañas
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Ver campañas preparadas,
                en curso y completadas.
              </p>
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}

// =====================================================
// LOADING
// =====================================================

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-400">
          Tvameva
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Cargando panel...
        </p>
      </div>
    </main>
  );
}