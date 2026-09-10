export type CleaningAssignmentExplanation = {
  version: 1;
  decidedAt: string;
  reason: "rotation" | "replacement" | "rescheduled" | "bulk";
  availability: string;
  countedTasks: number;
  fairnessFrom: string;
  correctionPenalty: number;
  candidateCount: number;
  selectionFactor?: string;
};

export function makeCleaningAssignmentExplanation(input: Omit<CleaningAssignmentExplanation, "version" | "decidedAt">): CleaningAssignmentExplanation {
  return { version: 1, decidedAt: new Date().toISOString(), ...input };
}

export function cleaningSelectionFactor(
  selected: { availability: string; countedTasks: number; correctionPenalty: number },
  next: { availability: string; countedTasks: number; correctionPenalty: number } | null
) {
  if (!next) return "only_candidate";
  if (selected.availability !== next.availability) return "availability";
  if (selected.countedTasks !== next.countedTasks) return "workload";
  if (selected.correctionPenalty !== next.correctionPenalty) return "correction";
  return "name";
}
