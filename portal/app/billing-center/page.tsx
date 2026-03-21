import { CoinsClient } from "../../components/coins-client";
import { FinesClient } from "../../components/fines-client";
import { PaymentsClient } from "../../components/payments-client";

export default function BillingCenterPage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Billing & Fines</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tickets, fees, payments, and fines are organized together on this tab.
        </p>
      </section>

      <CoinsClient />
      <PaymentsClient />
      <FinesClient />
    </div>
  );
}
