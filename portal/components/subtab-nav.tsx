"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

type TabItem = {
  href: Route;
  label: string;
};

export function SubtabNav({ tabs }: { tabs: TabItem[] }) {
  const pathname = usePathname();

  return (
    <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 hide-scrollbar sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-3">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
