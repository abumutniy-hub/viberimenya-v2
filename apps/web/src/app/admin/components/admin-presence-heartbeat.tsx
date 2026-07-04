"use client";

import { useEffect } from "react";

export function AdminPresenceHeartbeat() {
  useEffect(() => {
    let isStopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function ping() {
      if (isStopped) return;

      try {
        await fetch("/api/admin/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
      } catch {
        // presence should not interrupt CRM work
      }
    }

    void ping();
    timer = setInterval(() => {
      void ping();
    }, 30000);

    return () => {
      isStopped = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
