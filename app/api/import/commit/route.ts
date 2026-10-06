import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  parsePhoneNumberFromString,
} from "libphonenumber-js";

import type {
  CountryCode,
} from "libphonenumber-js";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// CONFIGURACIÓN
// =====================================================

const DEFAULT_COUNTRY: CountryCode =
  "AR";

const MAX_CONTACTS =
  20000;

const QUERY_CHUNK_SIZE =
  200;

const INSERT_CHUNK_SIZE =
  250;

// =====================================================
// TIPOS
// =====================================================

type IncomingContact = {
  firstName?: unknown;
  lastName?: unknown;

  phoneOriginal?: unknown;
  phoneE164?: unknown;

  email?: unknown;
  city?: unknown;
  course?: unknown;
  contactedBy?: unknown;

  sourceData?: unknown;
};

type ImportMetadata = {
  fileName: string;
  sheetName: string;
  source: string;
};

// =====================================================
// POST
// =====================================================

export async function POST(
  request: NextRequest
) {
  try {
    const supabase =
      await createClient();

    // =================================================
    // AUTENTICACIÓN
    // =================================================

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "No hay una sesión válida.",
        },
        {
          status: 401,
        }
      );
    }

    // =================================================
    // MEMBRESÍA
    // =================================================

    const {
      data: membership,
      error: membershipError,
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

    if (
      membershipError ||
      !membership
    ) {
      console.error(
        "Error obteniendo membresía:",
        membershipError
      );

      return NextResponse.json(
        {
          error:
            "No pudimos identificar tu organización.",
        },
        {
          status: 403,
        }
      );
    }

    // =================================================
    // BODY
    // =================================================

    const body =
      await request.json();

    if (
      !Array.isArray(
        body?.contacts
      )
    ) {
      return NextResponse.json(
        {
          error:
            "El lote de contactos no es válido.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      body.contacts.length >
      MAX_CONTACTS
    ) {
      return NextResponse.json(
        {
          error:
            `El lote supera el máximo de ${MAX_CONTACTS.toLocaleString(
              "es-AR"
            )} contactos.`,
        },
        {
          status: 400,
        }
      );
    }

    const metadata:
      ImportMetadata = {
      fileName:
        safeText(
          body?.metadata
            ?.fileName,
          250
        ),

      sheetName:
        safeText(
          body?.metadata
            ?.sheetName,
          250
        ),

      source:
        safeText(
          body?.metadata
            ?.source,
          50
        ),
    };

    // =================================================
    // VALIDACIÓN DEL SERVIDOR
    // =================================================

    const validContacts =
      new Map<
        string,
        {
          firstName: string;
          lastName: string;

          phoneOriginal: string;
          phoneE164: string;

          email: string;

          city: string;
          course: string;
          contactedBy: string;

          sourceData:
            Record<
              string,
              unknown
            >;
        }
      >();

    let invalidCount = 0;
    let duplicatePayloadCount = 0;

    for (
      const rawContact of
      body.contacts as IncomingContact[]
    ) {
      const phoneOriginal =
        safeText(
          rawContact.phoneOriginal,
          100
        );

      const requestedPhone =
        safeText(
          rawContact.phoneE164,
          30
        );

      const phoneE164 =
        normalizePhone(
          requestedPhone ||
            phoneOriginal
        );

      if (!phoneE164) {
        invalidCount += 1;

        continue;
      }

      if (
        validContacts.has(
          phoneE164
        )
      ) {
        duplicatePayloadCount +=
          1;

        continue;
      }

      validContacts.set(
        phoneE164,
        {
          firstName:
            safeText(
              rawContact.firstName,
              200
            ),

          lastName:
            safeText(
              rawContact.lastName,
              200
            ),

          phoneOriginal,

          phoneE164,

          email:
            safeText(
              rawContact.email,
              320
            )
              .trim()
              .toLowerCase(),

          city:
            safeText(
              rawContact.city,
              250
            ),

          course:
            safeText(
              rawContact.course,
              250
            ),

          contactedBy:
            safeText(
              rawContact.contactedBy,
              250
            ),

          sourceData:
            safeObject(
              rawContact.sourceData
            ),
        }
      );
    }

    const uniqueContacts =
      Array.from(
        validContacts.values()
      );

    // =================================================
    // COMPROBAR EXISTENTES NUEVAMENTE
    // =================================================

    const existingPhones =
      new Set<string>();

    const allPhones =
      uniqueContacts.map(
        (contact) =>
          contact.phoneE164
      );

    for (
      let index = 0;
      index <
      allPhones.length;
      index +=
        QUERY_CHUNK_SIZE
    ) {
      const chunk =
        allPhones.slice(
          index,
          index +
            QUERY_CHUNK_SIZE
        );

      if (
        chunk.length === 0
      ) {
        continue;
      }

      const {
        data,
        error,
      } = await supabase
        .from("contacts")
        .select(
          "phone_e164"
        )
        .eq(
          "organization_id",
          membership.organization_id
        )
        .in(
          "phone_e164",
          chunk
        );

      if (error) {
        console.error(
          "Error revalidando duplicados:",
          error
        );

        return NextResponse.json(
          {
            error:
              "No pudimos verificar los contactos existentes.",
          },
          {
            status: 500,
          }
        );
      }

      for (
        const contact of
        data ?? []
      ) {
        if (
          contact.phone_e164
        ) {
          existingPhones.add(
            contact.phone_e164
          );
        }
      }
    }

    const contactsToInsert =
      uniqueContacts.filter(
        (contact) =>
          !existingPhones.has(
            contact.phoneE164
          )
      );

    // =================================================
    // INSERTAR
    // =================================================

    let importedCount = 0;

    for (
      let index = 0;
      index <
      contactsToInsert.length;
      index +=
        INSERT_CHUNK_SIZE
    ) {
      const chunk =
        contactsToInsert.slice(
          index,
          index +
            INSERT_CHUNK_SIZE
        );

      const rows =
        chunk.map(
          (contact) => ({
            organization_id:
              membership.organization_id,

            branch_id:
              membership.branch_id,

            first_name:
              contact.firstName ||
              null,

            last_name:
              contact.lastName ||
              null,

            phone_original:
              contact.phoneOriginal ||
              contact.phoneE164,

            phone_e164:
              contact.phoneE164,

            email:
              contact.email ||
              null,

            /*
             * No asumimos consentimiento
             * automáticamente.
             */
            opted_in: false,

            status:
              "active",

            source_data: {
              raw:
                contact.sourceData,

              mapped: {
                city:
                  contact.city,

                course:
                  contact.course,

                contacted_by:
                  contact.contactedBy,
              },

              import: {
                file_name:
                  metadata.fileName,

                sheet_name:
                  metadata.sheetName,

                source:
                  metadata.source,

                imported_at:
                  new Date().toISOString(),
              },
            },
          })
        );

      /*
       * ignoreDuplicates es una segunda
       * protección ante una condición de
       * carrera entre revisión e importación.
       */

      const {
        data,
        error,
      } = await supabase
        .from("contacts")
        .upsert(
          rows,
          {
            onConflict:
              "organization_id,phone_e164",

            ignoreDuplicates:
              true,
          }
        )
        .select(
          "id, phone_e164"
        );

      if (error) {
        console.error(
          "Error importando contactos:",
          error
        );

        return NextResponse.json(
          {
            error:
              "Ocurrió un error mientras se guardaban los contactos.",
          },
          {
            status: 500,
          }
        );
      }

      importedCount +=
        data?.length ?? 0;
    }

    // =================================================
    // RESULTADO
    // =================================================

    const skippedExistingCount =
      existingPhones.size +
      Math.max(
        0,
        contactsToInsert.length -
          importedCount
      );

    return NextResponse.json({
      receivedCount:
        body.contacts.length,

      importedCount,

      skippedExistingCount,

      invalidCount,

      duplicatePayloadCount,
    });
  } catch (error) {
    console.error(
      "Error confirmando importación:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Ocurrió un error al importar los contactos.",
      },
      {
        status: 500,
      }
    );
  }
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
    candidate.startsWith(
      "00"
    )
  ) {
    candidate =
      `+${candidate.slice(
        2
      )}`;
  } else if (
    !candidate.startsWith(
      "+"
    ) &&
    candidate.startsWith(
      "54"
    ) &&
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
// TEXTO SEGURO
// =====================================================

function safeText(
  value: unknown,
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
// OBJETO JSON SEGURO
// =====================================================

function safeObject(
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

  try {
    return JSON.parse(
      JSON.stringify(
        value
      )
    ) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}