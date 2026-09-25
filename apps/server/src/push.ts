import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/index.js';

let vapidPublic = '';
let enabled = false;

export async function initPush() {
  let pub = config.vapidPublicKey;
  let priv = config.vapidPrivateKey;
  if (!pub || !priv) {
    const row = await db.select().from(schema.settings).where(eq(schema.settings.key, 'vapid')).limit(1);
    if (row.length)
      ({ publicKey: pub, privateKey: priv } = row[0].value as { publicKey: string; privateKey: string });
    else {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      await db.insert(schema.settings).values({ key: 'vapid', value: keys });
      console.log('Generated VAPID keys for web push (stored in the database).');
    }
  }
  webpush.setVapidDetails(config.vapidSubject, pub, priv);
  vapidPublic = pub;
  enabled = true;
}

export const vapidPublicKey = () => vapidPublic;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export async function sendPush(userIds: string[], payload: PushPayload) {
  if (!enabled || !userIds.length) return;
  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(inArray(schema.pushSubscriptions.userId, userIds));
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600 * 12 },
        );
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410)
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
        else console.warn('push failed', code ?? e);
      }
    }),
  );
}
