import webpush from "web-push";
import { prisma } from "./prisma.js";

const vapidPublic = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
const vapidPrivate = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
const vapidConfigured = Boolean(vapidPublic && vapidPrivate);

if (vapidConfigured) {
  webpush.setVapidDetails("mailto:admin@cozorohome.com", vapidPublic, vapidPrivate);
}

export const VAPID_PUBLIC_KEY = vapidPublic;

export async function savePushSubscription(email: string, subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  await prisma.$executeRaw`
    INSERT INTO PushSubscription (email, endpoint, p256dh, auth, createdAt)
    VALUES (${email}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, NOW())
    ON DUPLICATE KEY UPDATE email=${email}, p256dh=${subscription.keys.p256dh}, auth=${subscription.keys.auth}
  `;
}

export async function deletePushSubscription(endpoint: string) {
  await prisma.$executeRaw`DELETE FROM PushSubscription WHERE endpoint = ${endpoint}`;
}

type PushRow = { id: number; email: string; endpoint: string; p256dh: string; auth: string };

export async function sendPushToEmail(
  email: string,
  title: string,
  body: string,
  url?: string
) {
  if (!vapidConfigured) return;

  const subs = await prisma.$queryRaw<PushRow[]>`
    SELECT id, email, endpoint, p256dh, auth FROM PushSubscription WHERE email = ${email}
  `;
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url: url ?? "/" });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await prisma.$executeRaw`DELETE FROM PushSubscription WHERE id = ${sub.id}`.catch(() => {});
        }
      }
    })
  );
}
