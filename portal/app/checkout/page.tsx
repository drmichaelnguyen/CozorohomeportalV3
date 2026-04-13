import { redirect } from "next/navigation";

/** Canonical URL is `/check-out` (matches app.cozorohome.com/check-out). */
export default function CheckoutLegacyRedirectPage() {
  redirect("/check-out");
}
