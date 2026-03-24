import { SubtabNav } from "../../components/subtab-nav";
import type { Route } from "next";

export default function ServiceLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/service/laundry" as Route, label: "Laundry / Giặt là" },
    { href: "/service/controller" as Route, label: "Controller / Máy lạnh" }
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Service / Dịch vụ</h1>
        <p className="mt-2 text-sm text-slate-600">
          Navigate between laundry booking and controller access below. / Sử dụng các tab bên dưới để chuyển giữa đặt lịch giặt là và điều khiển máy lạnh.
        </p>
        <SubtabNav tabs={tabs} />
      </section>
      {children}
    </div>
  );
}
