import {
  NextRequest,
  NextResponse,
} from "next/server";

import { createClient } from "@/lib/supabase/server";

// =====================================================
// CONFIGURACIÓN
// =====================================================

const MAX_PHONES = 20000;
const QUERY_CHUNK_SIZE = 200;

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
    // USUARIO
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
    // ORGANIZACIÓN DEL USUARIO
    // =================================================

    const {
      data: membership,
      error: membershipError,
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
        body?.phones
      )
    ) {
      return NextResponse.json(
        {
          error:
            "La lista de teléfonos no es válida.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      body.phones.length >
      MAX_PHONES
    ) {
      return NextResponse.json(
        {
          error:
            `El lote supera el máximo de ${MAX_PHONES.toLocaleString(
              "es-AR"
            )} teléfonos.`,
        },
        {
          status: 400,
        }
      );
    }

    // =================================================
    // LIMPIAR TELÉFONOS
    // =================================================

    const phones = Array.from(
      new Set(
        body.phones
          .map(
            (
              value: unknown
            ) =>
              String(
                value ?? ""
              ).trim()
          )
          .filter(
            (
              value: string
            ) =>
              /^\+\d{7,15}$/.test(
                value
              )
          )
      )
    );

    if (
      phones.length === 0
    ) {
      return NextResponse.json({
        existingPhones: [],
      });
    }

    // =================================================
    // BUSCAR EXISTENTES EN TVAMEVA
    // =================================================

    const existingPhones =
      new Set<string>();

    for (
      let index = 0;
      index <
      phones.length;
      index +=
        QUERY_CHUNK_SIZE
    ) {
      const chunk =
        phones.slice(
          index,
          index +
            QUERY_CHUNK_SIZE
        );

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
          "Error buscando duplicados:",
          error
        );

        return NextResponse.json(
          {
            error:
              "No se pudieron comprobar los contactos existentes.",
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

    // =================================================
    // RESULTADO
    // =================================================

    return NextResponse.json({
      existingPhones:
        Array.from(
          existingPhones
        ),
    });
  } catch (error) {
    console.error(
      "Error revisando lote:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Ocurrió un error al revisar el lote.",
      },
      {
        status: 500,
      }
    );
  }
}