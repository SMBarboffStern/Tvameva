import Link from "next/link";
import { Suspense } from "react";

import {
  notFound,
  redirect,
} from "next/navigation";

import {
  revalidatePath,
} from "next/cache";

import {
  parsePhoneNumberFromString,
} from "libphonenumber-js";

import type {
  CountryCode,
} from "libphonenumber-js";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// TIPOS
// =====================================================

type ContactPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type ContactStatus =
  | "active"
  | "unsubscribed"
  | "invalid";

type ContactRecord = {
  id: string;

  organization_id: string;
  branch_id: string | null;

  first_name: string | null;
  last_name: string | null;

  phone_original: string | null;
  phone_e164: string;

  email: string | null;

  source_data: unknown;

  opted_in: boolean;

  status: ContactStatus;

  created_at: string;
  updated_at: string;
};

// =====================================================
// CONFIGURACIÓN
// =====================================================

const DEFAULT_COUNTRY:
  CountryCode = "AR";

// =====================================================
// PÁGINA
// =====================================================

export default function ContactPage({
  params,
}: ContactPageProps) {
  return (
    <Suspense
      fallback={
        <LoadingScreen />
      }
    >
      <ContactContent
        params={params}
      />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO
// =====================================================

async function ContactContent({
  params,
}: ContactPageProps) {
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
  // CONTACTO
  // ===================================================

  const {
    data,
    error,
  } = await supabase
    .from("contacts")
    .select(
      `
        id,
        organization_id,
        branch_id,
        first_name,
        last_name,
        phone_original,
        phone_e164,
        email,
        source_data,
        opted_in,
        status,
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
    error ||
    !data
  ) {
    notFound();
  }

  const contact =
    data as ContactRecord;

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
  // DATOS EXTRA
  // ===================================================

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

  const contactedBy =
    getMappedText(
      contact.source_data,
      "contacted_by"
    );

  const importInfo =
    getImportInfo(
      contact.source_data
    );

  // ===================================================
  // GUARDAR CONTACTO
  // ===================================================

  async function saveContact(
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

    const {
      data: currentContact,
      error:
        currentContactError,
    } = await supabase
      .from("contacts")
      .select(
        `
          id,
          source_data
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
      currentContactError ||
      !currentContact
    ) {
      throw new Error(
        "El contacto no existe o no tenés acceso."
      );
    }

    const firstName =
      safeText(
        formData.get(
          "first_name"
        ),
        200
      );

    const lastName =
      safeText(
        formData.get(
          "last_name"
        ),
        200
      );

    const phoneOriginal =
      safeText(
        formData.get(
          "phone"
        ),
        100
      );

    const email =
      safeText(
        formData.get(
          "email"
        ),
        320
      )
        .toLowerCase();

    const city =
      safeText(
        formData.get(
          "city"
        ),
        250
      );

    const course =
      safeText(
        formData.get(
          "course"
        ),
        250
      );

    const contactedBy =
      safeText(
        formData.get(
          "contacted_by"
        ),
        250
      );

    if (!phoneOriginal) {
      throw new Error(
        "El teléfono es obligatorio."
      );
    }

    const phoneE164 =
      normalizePhone(
        phoneOriginal
      );

    if (!phoneE164) {
      throw new Error(
        "El teléfono ingresado no parece ser válido."
      );
    }

    const sourceData =
      mergeSourceData(
        currentContact.source_data,
        {
          city,
          course,
          contacted_by:
            contactedBy,
        }
      );

    const {
      error,
    } = await supabase
      .from("contacts")
      .update({
        first_name:
          firstName ||
          null,

        last_name:
          lastName ||
          null,

        phone_original:
          phoneOriginal,

        phone_e164:
          phoneE164,

        email:
          email ||
          null,

        source_data:
          sourceData,

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
        "Error actualizando contacto:",
        error
      );

      if (
        error.code ===
        "23505"
      ) {
        throw new Error(
          "Ya existe otro contacto con ese teléfono."
        );
      }

      throw new Error(
        "No se pudo actualizar el contacto."
      );
    }

    revalidatePath(
      `/protected/contactos/${id}`
    );

    revalidatePath(
      "/protected/contactos"
    );

    revalidatePath(
      "/protected"
    );

    redirect(
      `/protected/contactos/${id}`
    );
  }

  // ===================================================
  // CAMBIAR ESTADO
  // ===================================================

  async function toggleContactStatus() {
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

    const {
      data: currentContact,
      error:
        contactError,
    } = await supabase
      .from("contacts")
      .select(
        "status"
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
      contactError ||
      !currentContact
    ) {
      throw new Error(
        "No se encontró el contacto."
      );
    }

    const newStatus =
      currentContact.status ===
      "unsubscribed"
        ? "active"
        : "unsubscribed";

    const {
      error,
    } = await supabase
      .from("contacts")
      .update({
        status:
          newStatus,

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
        "Error cambiando estado:",
        error
      );

      throw new Error(
        "No se pudo cambiar el estado del contacto."
      );
    }

    revalidatePath(
      `/protected/contactos/${id}`
    );

    revalidatePath(
      "/protected/contactos"
    );

    revalidatePath(
      "/protected"
    );

    redirect(
      `/protected/contactos/${id}`
    );
  }

  // ===================================================
  // INTERFAZ
  // ===================================================

  const fullName =
    [
      contact.first_name,
      contact.last_name,
    ]
      .filter(Boolean)
      .join(" ") ||
    "Contacto sin nombre";

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
            href="/protected/contactos"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            ← Volver a contactos
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10">
        {/* CABECERA */}

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Ficha de contacto
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              {fullName}
            </h2>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ContactStatusBadge
                status={
                  contact.status
                }
              />

              <span className="text-sm text-slate-500">
                Alta:{" "}
                {formatDate(
                  contact.created_at
                )}
              </span>
            </div>
          </div>

          <form
            action={
              toggleContactStatus
            }
          >
            {contact.status ===
            "unsubscribed" ? (
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Reactivar contacto
              </button>
            ) : (
              <button
                type="submit"
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 font-semibold text-amber-200 transition hover:bg-amber-500/20"
              >
                No contactar
              </button>
            )}
          </form>
        </div>

        {/* AVISO */}

        {contact.status ===
          "unsubscribed" && (
          <div className="mt-7 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="font-semibold text-amber-200">
              Este contacto está marcado
              como “No contactar”.
            </p>

            <p className="mt-1 text-sm text-amber-100/70">
              Tvameva deberá excluirlo
              automáticamente de futuras
              campañas.
            </p>
          </div>
        )}

        {/* FORMULARIO */}

        <form
          action={saveContact}
          className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Datos principales
            </p>

            <h3 className="mt-2 text-xl font-semibold">
              Editar contacto
            </h3>
          </div>

          <div className="mt-7 grid gap-5 md:grid-cols-2">
            <Field
              label="Nombre"
              name="first_name"
              defaultValue={
                contact.first_name ??
                ""
              }
            />

            <Field
              label="Apellido"
              name="last_name"
              defaultValue={
                contact.last_name ??
                ""
              }
            />

            <Field
              label="Teléfono"
              name="phone"
              required
              defaultValue={
                contact.phone_original ||
                contact.phone_e164
              }
            />

            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={
                contact.email ??
                ""
              }
            />

            <Field
              label="Ciudad"
              name="city"
              defaultValue={city}
            />

            <Field
              label="Curso / actividad"
              name="course"
              defaultValue={course}
            />

            <Field
              label="Quién contactó"
              name="contacted_by"
              defaultValue={
                contactedBy
              }
            />

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Teléfono normalizado
              </label>

              <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-emerald-300">
                {contact.phone_e164}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Guardar cambios
            </button>
          </div>
        </form>

        {/* ORIGEN */}

        <div className="mt-7 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Trazabilidad
          </p>

          <h3 className="mt-2 text-xl font-semibold">
            Origen del contacto
          </h3>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard
              title="Archivo"
              value={
                importInfo.fileName ||
                "Sin información"
              }
            />

            <InfoCard
              title="Hoja"
              value={
                importInfo.sheetName ||
                "Sin información"
              }
            />

            <InfoCard
              title="Origen"
              value={
                humanizeSource(
                  importInfo.source
                )
              }
            />

            <InfoCard
              title="Importado"
              value={
                importInfo.importedAt
                  ? formatDateTime(
                      importInfo.importedAt
                    )
                  : "Sin información"
              }
            />

            <InfoCard
              title="Estado"
              value={
                statusLabel(
                  contact.status
                )
              }
            />

            <InfoCard
              title="Última actualización"
              value={
                formatDateTime(
                  contact.updated_at
                )
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}

// =====================================================
// FIELD
// =====================================================

function Field({
  label,
  name,
  defaultValue,
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-sm font-medium text-slate-300"
      >
        {label}

        {required && (
          <span className="ml-1 text-emerald-400">
            *
          </span>
        )}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
      />
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
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">
        {title}
      </p>

      <p className="mt-2 break-words text-sm font-medium text-slate-200">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// BADGE
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
      <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
        Activo
      </span>
    );
  }

  if (
    status ===
    "unsubscribed"
  ) {
    return (
      <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200">
        No contactar
      </span>
    );
  }

  return (
    <span className="rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300">
      Inválido
    </span>
  );
}

// =====================================================
// TELÉFONO
// =====================================================

function normalizePhone(
  rawValue: string
): string | null {
  const raw =
    rawValue.trim();

  if (!raw) {
    return null;
  }

  let candidate =
    raw.replace(
      /[^\d+]/g,
      ""
    );

  if (!candidate) {
    return null;
  }

  if (
    candidate.startsWith("00")
  ) {
    candidate =
      `+${candidate.slice(2)}`;
  } else if (
    !candidate.startsWith("+") &&
    candidate.startsWith("54") &&
    candidate.length >= 11
  ) {
    candidate =
      `+${candidate}`;
  }

  const phone =
    parsePhoneNumberFromString(
      candidate,
      DEFAULT_COUNTRY
    );

  if (
    !phone ||
    !phone.isValid()
  ) {
    return null;
  }

  return phone.number;
}

// =====================================================
// SOURCE DATA
// =====================================================

function mergeSourceData(
  sourceData: unknown,
  mappedValues: {
    city: string;
    course: string;
    contacted_by: string;
  }
) {
  const root =
    normalizeObject(
      sourceData
    );

  const currentMapped =
    normalizeObject(
      root.mapped
    );

  return {
    ...root,

    mapped: {
      ...currentMapped,
      ...mappedValues,
    },
  };
}

function getMappedText(
  sourceData: unknown,
  key: string
) {
  const root =
    normalizeObject(
      sourceData
    );

  const mapped =
    normalizeObject(
      root.mapped
    );

  return String(
    mapped[key] ?? ""
  ).trim();
}

function getImportInfo(
  sourceData: unknown
) {
  const root =
    normalizeObject(
      sourceData
    );

  const importData =
    normalizeObject(
      root.import
    );

  return {
    fileName:
      String(
        importData.file_name ??
          ""
      ),

    sheetName:
      String(
        importData.sheet_name ??
          ""
      ),

    source:
      String(
        importData.source ??
          ""
      ),

    importedAt:
      String(
        importData.imported_at ??
          ""
      ),
  };
}

function normalizeObject(
  value: unknown
): Record<
  string,
  unknown
> {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<
    string,
    unknown
  >;
}

// =====================================================
// TEXT
// =====================================================

function safeText(
  value: FormDataEntryValue | null,
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
// LABELS
// =====================================================

function statusLabel(
  status: ContactStatus
) {
  if (
    status === "active"
  ) {
    return "Activo";
  }

  if (
    status === "unsubscribed"
  ) {
    return "No contactar";
  }

  return "Inválido";
}

function humanizeSource(
  source: string
) {
  if (
    source === "drive"
  ) {
    return "Google Drive";
  }

  if (
    source === "drop"
  ) {
    return "Arrastrar y soltar";
  }

  if (
    source === "device"
  ) {
    return "Archivo del dispositivo";
  }

  return source ||
    "Sin información";
}

// =====================================================
// FECHAS
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
          Cargando contacto...
        </p>
      </div>
    </main>
  );
}