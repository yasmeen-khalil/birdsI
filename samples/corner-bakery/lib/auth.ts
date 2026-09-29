import jwt from "jsonwebtoken";

export interface Session {
  userId: string;
  role: "customer" | "staff";
}

export function readSession(token: string | undefined): Session | null {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || "bakery-secret-2024") as Session;
  } catch {
    return null;
  }
}

export function signSession(session: Session): string {
  return jwt.sign(session, process.env.JWT_SECRET || "bakery-secret-2024", { algorithm: "HS256" });
}
