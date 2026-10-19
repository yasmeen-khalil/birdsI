const allowed = (process.env.DEV_USER_IDS ?? "").split(",");

export default function OpsPage() {
  return <main>{allowed.length} operators</main>;
}
