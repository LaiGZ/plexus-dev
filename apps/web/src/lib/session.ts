import { useEffect, useState } from "react";
import { api, type MeResponse } from "./api";

/** Session user for the current tab; the router guard already rejected anonymous users. */
export function useMe() {
  const [user, setUser] = useState<MeResponse["user"] | null>(null);

  useEffect(() => {
    let alive = true;
    api<MeResponse>("/api/auth/me")
      .then((r) => {
        if (alive) setUser(r.user);
      })
      .catch(() => {
        if (alive) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return user;
}
