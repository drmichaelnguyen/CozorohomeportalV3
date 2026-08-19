import { CleaningScheduleClient } from "../../components/cleaning-schedule-client";
import { RewardedCleaningClient } from "../../components/rewarded-cleaning-client";

export default function CleaningSchedulePage() {
  return (
    <div className="space-y-8">
      <RewardedCleaningClient />
      <CleaningScheduleClient />
    </div>
  );
}
