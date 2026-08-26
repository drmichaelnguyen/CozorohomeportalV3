import { CleaningScheduleClient } from "../../components/cleaning-schedule-client";
import { NextLaundryPreviewClient } from "../../components/next-laundry-preview-client";
import { NextPaymentPreviewClient } from "../../components/next-payment-preview-client";
import { RewardedCleaningClient } from "../../components/rewarded-cleaning-client";

export default function SchedulePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review your next payment, upcoming laundry, cleaning schedules, and optional rewarded cleaning.
        </p>
      </section>

      <RewardedCleaningClient />
      <NextPaymentPreviewClient />
      <NextLaundryPreviewClient />
      <CleaningScheduleClient />
    </div>
  );
}
