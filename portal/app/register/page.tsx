import type { Metadata } from "next";

import { RegisterFormClient } from "../../components/register-form-client";

export const metadata: Metadata = {
  title: "Book A Hostel Bunk Bed",
  description:
    "Register for an automated and affordable CozoroHome hostel bunk bed in Ho Chi Minh City, with prices starting from 70,000 VND/day.",
  alternates: {
    canonical: "/register"
  }
};

export default function RegisterPage() {
  return <RegisterFormClient />;
}
