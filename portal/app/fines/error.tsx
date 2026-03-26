"use client";

import { StandardRouteError } from "../../components/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StandardRouteError error={error} reset={reset} serviceName="Fines" />;
}
