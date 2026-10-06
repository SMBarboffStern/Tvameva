// =====================================================
// TVAMEVA - MESSAGING TYPES
// =====================================================

export type MessagingMode =
  | "simulation"
  | "live";

export type SendMessageInput = {
  recipientId: string;

  contactId: string;

  phone: string;

  message: string;
};

export type SendMessageResult = {
  success: boolean;

  provider:
    string;

  externalMessageId:
    string | null;

  error:
    string | null;

  sentAt:
    string | null;

  simulatedAt:
    string | null;
};

export interface MessagingProvider {
  readonly name:
    string;

  readonly mode:
    MessagingMode;

  sendMessage(
    input:
      SendMessageInput
  ): Promise<
    SendMessageResult
  >;
}