"use client";

import { CriticalRouteError } from "../../components/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CriticalRouteError error={error} reset={reset} serviceName="Services" />;
}
