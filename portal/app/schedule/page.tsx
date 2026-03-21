import { CleaningScheduleClient } from "../../components/cleaning-schedule-client";
import { NextLaundryPreviewClient } from "../../components/next-laundry-preview-client";

export default function SchedulePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review your next laundry booking and all cleaning schedule details in one place.
        </p>
      </section>

      <NextLaundryPreviewClient />
      <CleaningScheduleClient />
    </div>
  );
}
