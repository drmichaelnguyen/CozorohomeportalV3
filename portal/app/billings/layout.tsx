import { SubtabNav } from "../../components/subtab-nav";
import type { Route } from "next";

export default function BillingsLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/billings/laundry-fee" as Route, label: "Laundry Fee" },
    { href: "/billings/payment" as Route, label: "Payment" },
    { href: "/billings/fine" as Route, label: "Fine" }
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Billings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Navigate between laundry fee, payment history, and fine details with the sub tabs below.
        </p>
        <SubtabNav tabs={tabs} />
      </section>
      {children}
    </div>
  );
}
