import type { Metadata } from "next";

import { ClientLoginClient } from "../../components/client-login-client";

export const metadata: Metadata = {
  title: "Hostel Resident Login",
  description:
    "Resident login for CozoroHome Hostel in Ho Chi Minh City. Explore automated hostel stays and bunk bed rental offers starting from 70,000 VND/day.",
  alternates: {
    canonical: "/client-login"
  }
};

export default function ClientLoginPage() {
  return <ClientLoginClient />;
}
