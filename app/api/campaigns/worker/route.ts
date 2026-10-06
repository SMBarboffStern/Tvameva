import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  processSimulationCampaign,
} from "@/lib/campaigns/simulation-worker";

// =====================================================
// POST
// =====================================================

export async function POST(
  request:
    NextRequest
) {
  try {
    const supabase =
      await createClient();

    // =================================================
    // AUTH
    // =================================================

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "No hay una sesión válida.",
        },
        {
          status:
            401,
        }
      );
    }

    // =================================================
    // MEMBERSHIP
    // =================================================

    const {
      data:
        membership,
    } = await supabase
      .from(
        "memberships"
      )
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
      return NextResponse.json(
        {
          error:
            "No pudimos identificar tu organización.",
        },
        {
          status:
            403,
        }
      );
    }

    // =================================================
    // BODY
    // =================================================

    const body =
      await request.json();

    const campaignId =
      String(
        body?.campaignId ??
        ""
      ).trim();

    if (!campaignId) {
      return NextResponse.json(
        {
          error:
            "Falta el identificador de la campaña.",
        },
        {
          status:
            400,
        }
      );
    }

    // =================================================
    // WORKER
    // =================================================

    const result =
      await processSimulationCampaign({
        supabase,

        campaignId,

        organizationId:
          membership.organization_id,
      });

    return NextResponse.json(
      result
    );
  } catch (error) {
    console.error(
      "Error ejecutando worker manual:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Ocurrió un error ejecutando el worker.",
      },
      {
        status:
          500,
      }
    );
  }
}