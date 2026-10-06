import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// PÁGINA PROTEGIDA
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
// CONTENIDO PROTEGIDO
// =====================================================

async function ProtectedContent() {
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

  // ===================================================
  // MEMBRESÍA
  // ===================================================

  const {
    data: memberships,
    error:
      membershipLookupError,
  } = await supabase
    .from("memberships")
    .select(
      `
        id,
        organization_id,
        branch_id,
        role
      `
    )
    .eq(
      "user_id",
      user.id
    )
    .limit(1);

  if (
    membershipLookupError
  ) {
    console.error(
      "Error buscando la membresía:",
      membershipLookupError
    );
  }

  const membership =
    memberships?.[0] ??
    null;

  // ===================================================
  // CREAR ESPACIO
  // ===================================================

  async function createWorkspace(
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

    const organizationName =
      String(
        formData.get(
          "organization"
        ) ?? ""
      ).trim();

    const branchName =
      String(
        formData.get(
          "branch"
        ) ?? ""
      ).trim();

    if (
      !organizationName ||
      !branchName
    ) {
      throw new Error(
        "La organización y la sede son obligatorias."
      );
    }

    // ===============================================
    // EVITAR DUPLICADO DE ESPACIO
    // ===============================================

    const {
      data:
        existingMemberships,

      error:
        existingMembershipError,
    } = await supabase
      .from("memberships")
      .select("id")
      .eq(
        "user_id",
        user.id
      )
      .limit(1);

    if (
      existingMembershipError
    ) {
      console.error(
        "Error verificando membresía existente:",
        existingMembershipError
      );

      throw new Error(
        "No se pudo verificar tu espacio de trabajo."
      );
    }

    if (
      existingMemberships &&
      existingMemberships.length >
        0
    ) {
      redirect(
        "/protected"
      );
    }

    // ===============================================
    // ORGANIZACIÓN
    // ===============================================

    const {
      data: organization,

      error:
        organizationError,
    } = await supabase
      .from("organizations")
      .insert({
        name:
          organizationName,

        created_by:
          user.id,
      })
      .select("id")
      .single();

    if (
      organizationError ||
      !organization
    ) {
      console.error(
        "Error creando organización:",
        organizationError
      );

      throw new Error(
        "No se pudo crear la organización."
      );
    }

    // ===============================================
    // MEMBRESÍA ADMIN
    // ===============================================

    const {
      data: newMembership,

      error:
        membershipError,
    } = await supabase
      .from("memberships")
      .insert({
        user_id:
          user.id,

        organization_id:
          organization.id,

        role:
          "admin",
      })
      .select("id")
      .single();

    if (
      membershipError ||
      !newMembership
    ) {
      console.error(
        "Error creando membresía:",
        membershipError
      );

      throw new Error(
        "No se pudo crear la membresía."
      );
    }

    // ===============================================
    // SEDE
    // ===============================================

    const {
      data: branch,

      error:
        branchError,
    } = await supabase
      .from("branches")
      .insert({
        organization_id:
          organization.id,

        name:
          branchName,
      })
      .select("id")
      .single();

    if (
      branchError ||
      !branch
    ) {
      console.error(
        "Error creando sede:",
        branchError
      );

      throw new Error(
        "No se pudo crear la sede."
      );
    }

    // ===============================================
    // ASIGNAR SEDE
    // ===============================================

    const {
      error:
        updateMembershipError,
    } = await supabase
      .from("memberships")
      .update({
        branch_id:
          branch.id,
      })
      .eq(
        "id",
        newMembership.id
      )
      .eq(
        "user_id",
        user.id
      );

    if (
      updateMembershipError
    ) {
      console.error(
        "Error asociando sede:",
        updateMembershipError
      );

      throw new Error(
        "No se pudo asociar la sede al usuario."
      );
    }

    redirect(
      "/protected"
    );
  }

  // ===================================================
  // ONBOARDING
  // ===================================================

  if (!membership) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-4 py-10 text-white">
        <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl md:p-12">
            <div className="mb-10 text-center">
              <div className="mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-emerald-400">
                Tvameva
              </div>

              <h1 className="text-3xl font-bold md:text-4xl">
                Bienvenido a Tvameva
              </h1>

              <p className="mt-4 text-slate-300">
                Configuremos tu espacio
                de trabajo.
              </p>
            </div>

            <form
              action={
                createWorkspace
              }
              className="space-y-6"
            >
              <div>
                <label
                  htmlFor="organization"
                  className="mb-2 block text-sm font-medium text-slate-200"
                >
                  Organización
                </label>

                <input
                  id="organization"
                  name="organization"
                  type="text"
                  required
                  defaultValue="El Arte de Vivir"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400"
                />
              </div>

              <div>
                <label
                  htmlFor="branch"
                  className="mb-2 block text-sm font-medium text-slate-200"
                >
                  Sede
                </label>

                <input
                  id="branch"
                  name="branch"
                  type="text"
                  required
                  placeholder="Ej. Villa del Parque"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Crear mi espacio
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  // ===================================================
  // ORGANIZACIÓN
  // ===================================================

  const organizationId =
    membership.organization_id;

  const {
    data: organization,
  } = await supabase
    .from("organizations")
    .select("name")
    .eq(
      "id",
      organizationId
    )
    .single();

  // ===================================================
  // SEDE
  // ===================================================

  let branchName =
    "Sin sede";

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
      .single();

    if (branch?.name) {
      branchName =
        branch.name;
    }
  }

  // ===================================================
  // MÉTRICAS
  // ===================================================

  const [
    contactsResult,
    templatesResult,
    campaignsResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "organization_id",
        organizationId
      ),

    supabase
      .from("templates")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "organization_id",
        organizationId
      ),

    supabase
      .from("campaigns")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "organization_id",
        organizationId
      ),
  ]);

  const contactCount =
    contactsResult.count ??
    0;

  const templateCount =
    templatesResult.count ??
    0;

  const campaignCount =
    campaignsResult.count ??
    0;

  // ===================================================
  // DASHBOARD
  // ===================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tvameva
            </h1>

            <p className="text-sm text-slate-400">
              {organization?.name ??
                "Organización"}
              {" · "}
              {branchName}
            </p>
          </div>

          <div className="text-right">
            <p className="max-w-[220px] truncate text-sm text-slate-300">
              {user.email}
            </p>

            <p className="text-xs uppercase tracking-wider text-emerald-400">
              {
                membership.role
              }
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-10">
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
        </div>

        {/* MÉTRICAS */}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardCard
            title="Contactos"
            value={
              contactCount
            }
            description="Personas disponibles"
            href="/protected/contactos"
          />

          <DashboardCard
            title="Plantillas"
            value={
              templateCount
            }
            description="Mensajes guardados"
          />

          <DashboardCard
            title="Campañas"
            value={
              campaignCount
            }
            description="Campañas creadas"
          />
        </div>

        {/* ACCIONES */}

        <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-7">
          <h3 className="text-xl font-semibold">
            Comenzá a trabajar
          </h3>

          <p className="mt-2 text-sm text-slate-400">
            Administrá tu base de
            contactos o importá una
            nueva planilla.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/protected/contactos"
              className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-200 transition hover:bg-white/5"
            >
              Ver contactos
            </Link>

            <Link
              href="/protected/importar"
              className="rounded-xl bg-emerald-500 px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Importar contactos
            </Link>

            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-xl border border-white/10 px-5 py-3 text-slate-500 opacity-60"
            >
              Nueva campaña
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// =====================================================
// CARGA
// =====================================================

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-400">
          Tvameva
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Cargando tu espacio...
        </p>
      </div>
    </main>
  );
}

// =====================================================
// TARJETA
// =====================================================

function DashboardCard({
  title,
  value,
  description,
  href,
}: {
  title: string;
  value: number;
  description: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-sm font-medium text-slate-400">
        {title}
      </p>

      <p className="mt-3 text-4xl font-bold">
        {value}
      </p>

      <p className="mt-2 text-sm text-slate-500">
        {description}
      </p>

      {href && (
        <p className="mt-5 text-sm font-medium text-emerald-400">
          Ver módulo →
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.05]"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl">
      {content}
    </div>
  );
}