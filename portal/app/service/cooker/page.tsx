import { ControllerClient } from "../../../components/controller-client";

export default function ServiceCookerPage() {
  return (
    <ControllerClient
      showAcSection={false}
      showAirFryerSection={false}
      showMicrowaveSection={false}
      showCookerSection
      title="Cooker"
    />
  );
}
