"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

// =====================================================
// PROPS
// =====================================================

type CampaignWorkerControlsProps = {
  campaignId: string;

  status:
    | "draft"
    | "ready"
    | "running"
    | "paused"
    | "completed"
    | "cancelled";

  executionMode:
    "simulation"
    | "live";
};

// =====================================================
// COMPONENT
// =====================================================

export default function CampaignWorkerControls({
  campaignId,
  status,
  executionMode,
}: CampaignWorkerControlsProps) {
  const router =
    useRouter();

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState<string | null>(
      null
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  // ===================================================
  // PROCESS
  // ===================================================

  async function processWorker() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response =
        await fetch(
          "/api/campaigns/worker",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                campaignId,
              }),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
          "No se pudo ejecutar el worker."
        );
      }

      setMessage(
        result.message ||
        "Worker ejecutado."
      );

      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Ocurrió un error ejecutando la simulación."
      );
    } finally {
      setLoading(false);
    }
  }

  // ===================================================
  // LIVE
  // ===================================================

  if (
    executionMode ===
    "live"
  ) {
    return null;
  }

  // ===================================================
  // COMPLETE
  // ===================================================

  if (
    status ===
      "completed"
  ) {
    return (
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-5">
        <p className="font-semibold text-violet-200">
          Simulación completada
        </p>

        <p className="mt-1 text-sm text-violet-100/60">
          Todos los destinatarios de esta
          campaña fueron procesados por el
          worker de prueba.
        </p>
      </div>
    );
  }

  // ===================================================
  // NOT RUNNING
  // ===================================================

  if (
    status !==
    "running"
  ) {
    return (
      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.05] p-5">
        <p className="font-medium text-blue-200">
          Worker de simulación
        </p>

        <p className="mt-1 text-sm text-blue-100/60">
          Primero iniciá la campaña. El worker
          solamente procesa campañas en estado
          “En curso”.
        </p>
      </div>
    );
  }

  // ===================================================
  // RUNNING
  // ===================================================

  return (
    <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Worker de simulación
          </p>

          <h3 className="mt-2 text-lg font-semibold">
            Procesar la cola
          </h3>

          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Tvameva procesará únicamente los
            destinatarios cuyo horario ya haya
            llegado y respetará los límites por
            hora, por día y la franja configurada.
          </p>
        </div>

        <button
          type="button"
          disabled={
            loading
          }
          onClick={
            processWorker
          }
          className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-50"
        >
          {loading
            ? "Procesando..."
            : "Procesar turno ahora"}
        </button>
      </div>

      {message && (
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-slate-950/40 p-4 text-sm text-emerald-200">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}