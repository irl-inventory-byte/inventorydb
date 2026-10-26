"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin bar at the top and a small "Loading…" label from the moment a link is clicked or a form is sent
 * until the new page is on screen, so it is always clear the app is working.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);

  // The new page is showing: hide.
  useEffect(() => setBusy(false), [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      setBusy(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBusy(false), 20000); // never stay on forever
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page (e.g. #anchor)
      start();
    };
    // A plain form, or one marked data-progress="1" (search filters and server-action forms such as a
    // correction, whose submit React handles itself).
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!e.defaultPrevented || form?.dataset?.progress === "1") start();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      clearTimeout(timer);
    };
  }, []);

  if (!busy) return null;
  return (
    <>
      <div className="nav-progress" aria-hidden="true" />
      <div className="nav-progress-label" role="status" aria-live="polite">
        Loading…
      </div>
    </>
  );
}