export async function push(userId: string, message: string) {
  const key = process.env.ONESIGNAL_API_KEY;
  if (!key) return;
  await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ app_id: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID, include_aliases: { external_id: [userId] }, contents: { en: message } }),
  });
}
