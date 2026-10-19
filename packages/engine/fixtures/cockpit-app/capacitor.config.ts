import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.cockpit",
  appName: "Cockpit",
  webDir: "public",
  server: { url: "https://cockpit.example.com" },
};

export default config;
