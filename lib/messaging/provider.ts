import "server-only";

import {
  SimulationMessagingProvider,
} from "@/lib/messaging/providers/simulation";

import type {
  MessagingMode,
  MessagingProvider,
} from "@/lib/messaging/types";

// =====================================================
// PROVIDER FACTORY
// =====================================================

export function getMessagingProvider(
  mode:
    MessagingMode
): MessagingProvider {
  if (
    mode ===
    "simulation"
  ) {
    return new SimulationMessagingProvider();
  }

  /*
   * IMPORTANTE
   *
   * Todavía no habilitamos producción.
   *
   * Cuando conectemos WhatsApp Cloud API
   * vamos a reemplazar este error por:
   *
   * return new WhatsAppCloudProvider(...)
   */

  throw new Error(
    "El proveedor de mensajería en producción todavía no está configurado."
  );
}