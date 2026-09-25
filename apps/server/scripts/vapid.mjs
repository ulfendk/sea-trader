// Prints a fresh VAPID key pair for web push (optional; the server generates and stores one automatically).
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
