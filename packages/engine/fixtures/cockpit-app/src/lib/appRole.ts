export const APP_ROLE: "app" | "ops" = process.env.APP_ROLE === "ops" ? "ops" : "app";
export const isOps = () => APP_ROLE === "ops";
