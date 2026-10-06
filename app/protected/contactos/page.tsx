import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// TIPOS
// =====================================================

type ContactsPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
  }>;
};

type ContactStatus =
  | "active"
  | "unsubscribed"
  | "invalid";

type ContactRow = {
  id: string;

  first_name: string | null;
  last_name: string | null;

  phone_original: string | null;
  phone_e164: string;

  email: string | null;

  status: ContactStatus;

  source_data: unknown;

  created_at: string;
};

// =====================================================
// CONFIGURACIÓN
// =====================================================

const PAGE_SIZE = 25;

// =====================================================
// PÁGINA
// =====================================================

export default function ContactsPage({
  searchParams,
}: ContactsPageProps) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ContactsContent
        searchParams={searchParams}
      />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function ContactsContent({
  searchParams,
}: ContactsPageProps) {
  const params =
    await searchParams;

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
    redirect("/auth/login");
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
    membershipError ||
    !membership
  ) {
    console.error(
      "Error obteniendo membresía:",
      membershipError
    );

    redirect("/protected");
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
  // FILTROS
  // ===================================================

  const search =
    String(
      params.q ?? ""
    ).trim();

  const requestedStatus =
    String(
      params.status ?? "all"
    );

  const status =
    isContactStatus(
      requestedStatus
    )
      ? requestedStatus
      : "all";

  const requestedPage =
    Number.parseInt(
      String(
        params.page ?? "1"
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
  // CONSULTA
  // ===================================================

  let query =
    supabase
      .from("contacts")
      .select(
        `
          id,
          first_name,
          last_name,
          phone_original,
          phone_e164,
          email,
          status,
          source_data,
          created_at
        `,
        {
          count: "exact",
        }
      )
      .eq(
        "organization_id",
        membership.organization_id
      );

  if (
    status !== "all"
  ) {
    query =
      query.eq(
        "status",
        status
      );
  }

  const cleanSearch =
    sanitizeSearch(
      search
    );

  if (cleanSearch) {
    query =
      query.or(
        [
          `first_name.ilike.%${cleanSearch}%`,
          `last_name.ilike.%${cleanSearch}%`,
          `phone_e164.ilike.%${cleanSearch}%`,
          `email.ilike.%${cleanSearch}%`,
        ].join(",")
      );
  }

  const {
    data,
    count,
    error,
  } =
    await query
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .range(
        from,
        to
      );

  if (error) {
    console.error(
      "Error cargando contactos:",
      error
    );
  }

  const contacts =
    (data ?? []) as ContactRow[];

  const totalContacts =
    count ?? 0;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalContacts /
          PAGE_SIZE
      )
    );

  // ===================================================
  // INTERFAZ
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
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            Volver al panel
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Base de contactos
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              Contactos
            </h2>

            <p className="mt-2 text-slate-400">
              Administrá las personas
              disponibles para tus campañas.
            </p>
          </div>

          <Link
            href="/protected/importar"
            className="rounded-xl bg-emerald-500 px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            + Importar contactos
          </Link>
        </div>

        {/* TOTAL */}

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm text-slate-400">
            Total encontrado
          </p>

          <p className="mt-2 text-4xl font-bold">
            {totalContacts}
          </p>
        </div>

        {/* FILTROS */}

        <form
          method="GET"
          className="mt-6 grid gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:grid-cols-[1fr_220px_auto]"
        >
          <div>
            <label
              htmlFor="q"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500"
            >
              Buscar
            </label>

            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Nombre, teléfono o email..."
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </div>

          <div>
            <label
              htmlFor="status"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500"
            >
              Estado
            </label>

            <select
              id="status"
              name="status"
              defaultValue={status}
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
            >
              <option value="all">
                Todos
              </option>

              <option value="active">
                Activos
              </option>

              <option value="unsubscribed">
                No contactar
              </option>

              <option value="invalid">
                Inválidos
              </option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            >
              Buscar
            </button>

            <Link
              href="/protected/contactos"
              className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition hover:bg-white/5"
            >
              Limpiar
            </Link>
          </div>
        </form>

        {/* TABLA */}

        <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/10 p-6">
            <h3 className="text-xl font-semibold">
              Contactos encontrados
            </h3>

            <p className="mt-1 text-sm text-slate-400">
              Página {currentPage} de{" "}
              {totalPages}
            </p>
          </div>

          {contacts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-white/10 bg-white/[0.03]">
                  <tr>
                    <th className="px-4 py-3 text-left text-slate-400">
                      Nombre
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Teléfono
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Email
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Ciudad
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Curso
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Estado
                    </th>

                    <th className="px-4 py-3 text-left text-slate-400">
                      Acción
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/5">
                  {contacts.map(
                    (contact) => {
                      const fullName =
                        [
                          contact.first_name,
                          contact.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ") ||
                        "Sin nombre";

                      const city =
                        getMappedText(
                          contact.source_data,
                          "city"
                        );

                      const course =
                        getMappedText(
                          contact.source_data,
                          "course"
                        );

                      return (
                        <tr
                          key={contact.id}
                          className="transition hover:bg-white/[0.025]"
                        >
                          <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-200">
                            {fullName}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                            {contact.phone_e164}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-slate-400">
                            {contact.email ||
                              "—"}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-slate-400">
                            {city ||
                              "—"}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-slate-400">
                            {course ||
                              "—"}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4">
                            <ContactStatusBadge
                              status={
                                contact.status
                              }
                            />
                          </td>

                          <td className="whitespace-nowrap px-4 py-4">
                            <Link
                              href={`/protected/contactos/${contact.id}`}
                              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300"
                            >
                              Ver contacto →
                            </Link>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center">
              <p className="font-medium text-slate-300">
                No encontramos contactos.
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Probá cambiando los filtros
                o importá una nueva planilla.
              </p>
            </div>
          )}
        </div>

        {/* PAGINACIÓN */}

        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="text-sm text-slate-500">
            {totalContacts === 0
              ? "0 registros"
              : `${from + 1}–${Math.min(
                  to + 1,
                  totalContacts
                )} de ${totalContacts}`}
          </div>

          <div className="flex gap-2">
            {currentPage > 1 ? (
              <Link
                href={buildContactsUrl({
                  q: search,
                  status,
                  page:
                    currentPage - 1,
                })}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                ← Anterior
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-xl border border-white/5 px-4 py-2 text-sm text-slate-700">
                ← Anterior
              </span>
            )}

            {currentPage <
            totalPages ? (
              <Link
                href={buildContactsUrl({
                  q: search,
                  status,
                  page:
                    currentPage + 1,
                })}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                Siguiente →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-xl border border-white/5 px-4 py-2 text-sm text-slate-700">
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
// BADGE ESTADO
// =====================================================

function ContactStatusBadge({
  status,
}: {
  status: ContactStatus;
}) {
  if (
    status === "active"
  ) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
        Activo
      </span>
    );
  }

  if (
    status ===
    "unsubscribed"
  ) {
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
        No contactar
      </span>
    );
  }

  return (
    <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-300">
      Inválido
    </span>
  );
}

// =====================================================
// DATOS EXTRA
// =====================================================

function getMappedText(
  sourceData: unknown,
  key: string
) {
  if (
    !sourceData ||
    typeof sourceData !==
      "object" ||
    Array.isArray(
      sourceData
    )
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
    Array.isArray(
      mapped
    )
  ) {
    return "";
  }

  const mappedObject =
    mapped as Record<
      string,
      unknown
    >;

  return String(
    mappedObject[
      key
    ] ?? ""
  ).trim();
}

// =====================================================
// BÚSQUEDA
// =====================================================

function sanitizeSearch(
  value: string
) {
  return value
    .replace(
      /[,%_()]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      100
    );
}

// =====================================================
// ESTADO
// =====================================================

function isContactStatus(
  value: string
): value is ContactStatus {
  return (
    value === "active" ||
    value === "unsubscribed" ||
    value === "invalid"
  );
}

// =====================================================
// PAGINACIÓN
// =====================================================

function buildContactsUrl({
  q,
  status,
  page,
}: {
  q: string;
  status:
    | ContactStatus
    | "all";
  page: number;
}) {
  const params =
    new URLSearchParams();

  if (q) {
    params.set(
      "q",
      q
    );
  }

  if (
    status !== "all"
  ) {
    params.set(
      "status",
      status
    );
  }

  if (page > 1) {
    params.set(
      "page",
      String(page)
    );
  }

  const query =
    params.toString();

  return query
    ? `/protected/contactos?${query}`
    : "/protected/contactos";
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
          Cargando contactos...
        </p>
      </div>
    </main>
  );
}