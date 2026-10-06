import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  processSimulationCampaign,
} from "@/lib/campaigns/simulation-worker";

// =====================================================
// CONFIG
// =====================================================

const MAX_CAMPAIGNS_PER_RUN =
  20;

// =====================================================
// GET
// =====================================================

export async function GET(
  request:
    NextRequest
) {
  return runSystemWorker(
    request
  );
}

// =====================================================
// POST
// =====================================================

export async function POST(
  request:
    NextRequest
) {
  return runSystemWorker(
    request
  );
}

// =====================================================
// RUN
// =====================================================

async function runSystemWorker(
  request:
    NextRequest
) {
  try {
    // =================================================
    // SECRET
    // =================================================

    const expectedSecret =
      process.env
        .SYSTEM_WORKER_SECRET;

    if (!expectedSecret) {
      console.error(
        "SYSTEM_WORKER_SECRET no está configurado."
      );

      return NextResponse.json(
        {
          error:
            "El worker del sistema no está configurado.",
        },
        {
          status:
            500,
        }
      );
    }

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      authorization !==
      `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          error:
            "No autorizado.",
        },
        {
          status:
            401,
        }
      );
    }

    // =================================================
    // ADMIN
    // =================================================

    const supabase =
      createAdminClient();

    const now =
      new Date();

    // =================================================
    // RUNNING CAMPAIGNS
    // =================================================

    const {
      data:
        campaigns,

      error:
        campaignsError,
    } = await supabase
      .from(
        "campaigns"
      )
      .select(
        `
          id,
          organization_id,
          next_run_at
        `
      )
      .eq(
        "status",
        "running"
      )
      .eq(
        "execution_mode",
        "simulation"
      )
      .order(
        "next_run_at",
        {
          ascending:
            true,

          nullsFirst:
            true,
        }
      )
      .limit(
        100
      );

    if (
      campaignsError
    ) {
      console.error(
        "Error buscando campañas:",
        campaignsError
      );

      return NextResponse.json(
        {
          error:
            "No se pudieron consultar las campañas.",
        },
        {
          status:
            500,
        }
      );
    }

    // =================================================
    // ONLY DUE CAMPAIGNS
    // =================================================

    const dueCampaigns =
      (campaigns ?? [])
        .filter(
          (
            campaign
          ) => {
            if (
              !campaign.next_run_at
            ) {
              return true;
            }

            const nextRun =
              new Date(
                campaign.next_run_at
              );

            if (
              Number.isNaN(
                nextRun.getTime()
              )
            ) {
              return true;
            }

            return (
              nextRun <=
              now
            );
          }
        )
        .slice(
          0,
          MAX_CAMPAIGNS_PER_RUN
        );

    // =================================================
    // PROCESS SERIAL
    // =================================================

    const results:
      Array<{
        campaignId:
          string;

        processed:
          number;

        remaining:
          number;

        completed:
          boolean;

        nextRunAt:
          string | null;

        message:
          string;
      }> = [];

    const errors:
      Array<{
        campaignId:
          string;

        error:
          string;
      }> = [];

    for (
      const campaign of
      dueCampaigns
    ) {
      try {
        const result =
          await processSimulationCampaign({
            supabase,

            campaignId:
              campaign.id,

            organizationId:
              campaign.organization_id,
          });

        results.push(
          result
        );
      } catch (error) {
        console.error(
          `Error procesando campaña ${campaign.id}:`,
          error
        );

        errors.push({
          campaignId:
            campaign.id,

          error:
            error instanceof Error
              ? error.message
              : "Error inesperado.",
        });
      }
    }

    // =================================================
    // RESPONSE
    // =================================================

    return NextResponse.json({
      ok:
        true,

      executedAt:
        now.toISOString(),

      runningCampaignsFound:
        campaigns?.length ??
        0,

      dueCampaigns:
        dueCampaigns.length,

      processedCampaigns:
        results.length,

      results,

      errors,
    });
  } catch (error) {
    console.error(
      "Error general del worker del sistema:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Ocurrió un error ejecutando el worker del sistema.",
      },
      {
        status:
          500,
      }
    );
  }
}