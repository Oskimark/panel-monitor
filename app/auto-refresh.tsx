"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Por defecto refresca cada 120s y solo cuando la pestaña está visible para no agotar cuotas Free.
export default function AutoRefresh({ everySeconds = 120 }: { everySeconds?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState("");

  useEffect(() => {
    setAt(new Date().toLocaleTimeString());

    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      start(() => {
        router.refresh();
        setAt(new Date().toLocaleTimeString());
      });
    };

    const id = setInterval(refreshIfVisible, everySeconds * 1000);
    return () => clearInterval(id);
  }, [router, everySeconds]);

  return (
    <div className="refresh">
      <span>{at ? `Actualizado a las ${at}` : ""}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(() => {
            router.refresh();
            setAt(new Date().toLocaleTimeString());
          })
        }
      >
        {pending ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </div>
  );
}
