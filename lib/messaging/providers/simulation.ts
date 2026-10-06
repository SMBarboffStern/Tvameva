import {
  randomUUID,
} from "crypto";

import type {
  MessagingProvider,
  SendMessageInput,
  SendMessageResult,
} from "@/lib/messaging/types";

// =====================================================
// SIMULATION PROVIDER
// =====================================================

export class SimulationMessagingProvider
  implements MessagingProvider
{
  readonly name =
    "simulation";

  readonly mode =
    "simulation" as const;

  async sendMessage(
    input:
      SendMessageInput
  ): Promise<
    SendMessageResult
  > {
    /*
     * La simulación NO llama a ningún
     * servicio externo.
     *
     * Solamente devuelve un resultado
     * compatible con un proveedor real.
     */

    void input;

    const now =
      new Date().toISOString();

    return {
      success:
        true,

      provider:
        this.name,

      externalMessageId:
        `simulation:${randomUUID()}`,

      error:
        null,

      sentAt:
        null,

      simulatedAt:
        now,
    };
  }
}