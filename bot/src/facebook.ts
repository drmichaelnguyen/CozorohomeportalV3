import crypto from "node:crypto";

import { config } from "./config.js";

type SendMessageInput = {
  recipientId: string;
  text: string;
};

export function verifyFacebookSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined) {
  if (!config.facebookAppSecret) {
    return true;
  }

  if (!rawBody || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", config.facebookAppSecret)
    .update(rawBody)
    .digest("hex");

  const provided = signatureHeader.slice("sha256=".length);
  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function sendMessengerTextMessage({ recipientId, text }: SendMessageInput) {
  if (!config.facebookPageAccessToken) {
    console.info(`[bot] Messenger token missing, skipped send to ${recipientId}: ${text}`);
    return;
  }

  const response = await fetch(
    `${config.facebookGraphApiBaseUrl}/me/messages?access_token=${encodeURIComponent(config.facebookPageAccessToken)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Messenger send failed with ${response.status}: ${errorText}`);
  }
}
