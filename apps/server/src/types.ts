import type { AuthUser } from "./domain/auth/service.js";

export type AppEnv = {
  Variables: {
    requestId: string;
    auth: AuthUser | null;
  };
};
