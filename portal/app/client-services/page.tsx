import { AccountOverviewClient } from "../../components/account-overview-client";
import { BookingsClient } from "../../components/bookings-client";
import { ControllerClient } from "../../components/controller-client";

export default function ClientServicesPage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Client Services</h1>
        <p className="mt-2 text-sm text-slate-600">
          Client information, service booking, and room controller are grouped here for faster access.
        </p>
      </section>

      <AccountOverviewClient />
      <BookingsClient />
      <ControllerClient />
    </div>
  );
}
