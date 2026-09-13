/**
 * Missed cleaning fine escalation — pure helpers for order-independent amounts.
 *
 * Policy (preserved from cleaning.ts):
 * - Base 15,000 VND if the resident has never had an active automatic cleaning fine;
 *   otherwise base 30,000 VND.
 * - Within the same duty month and same offence content:
 *   - 0 prior active offences → base
 *   - 1 prior → round(base * 1.5)
 *   - 2+ prior → max(base, latestPriorAmount) * 2
 *
 * "Duty month" is the scheduled duty date month, not the fine ticket creation month.
 * Cancelled / voided / exempt offences are excluded from escalation.
 * Applicable amount for a duty depends only on earlier duty dates (and stable task id ties),
 * so forward vs reverse processing of overdue tasks yields the same amounts.
 */

export const AUTO_CLEANING_FINE_DESCRIPTION_PREFIX = "Auto-generated for missed cleaning task.";

export const FINE_CONTENT_COLUMN = "N\u1ed8I DUNG VI PH\u1ea0M";
export const FINE_DESCRIPTION_COLUMN = "M\u00d4 T\u1ea2 VI PH\u1ea0M";
export const FINE_AMOUNT_COLUMN = "CHI PH\u00cd THANH TO\u00c1N CHO VI PH\u1ea0M";
export const FINE_STATUS_COLUMN = "\u0110\u00c3 THANH TO\u00c1N?";
export const FINE_DISPUTE_COLUMN = "Khieu nai tu khach hang";

export type MissedFineSheetRow = Record<string, string>;

export type MissedFineOffence = {
  taskId: string | null;
  dutyDate: Date | null;
  content: string;
  amount: number;
  row: MissedFineSheetRow;
};

export function parseFineAmount(value: string | undefined) {
  const numeric = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isSameUtcMonth(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();
}

export function isAutomaticCleaningFineRow(row: MissedFineSheetRow) {
  return (row[FINE_DESCRIPTION_COLUMN] ?? "").includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX);
}

export function isAutomaticCleaningFineForTask(row: MissedFineSheetRow, taskId: string) {
  const description = row[FINE_DESCRIPTION_COLUMN] ?? "";
  return description.includes(AUTO_CLEANING_FINE_DESCRIPTION_PREFIX) && description.includes(`Task ID: ${taskId}.`);
}

/** Parse `dd/mm/yyyy` duty date embedded in automatic missed-cleaning descriptions. */
export function parseDutyDateFromAutomaticCleaningFineDescription(description: string): Date | null {
  const match = description.match(
    /(?:complete|mark)\s+[^.]*?\s+on\s+(\d{2})\/(\d{2})\/(\d{4})/i
  ) ?? description.match(/scheduled on\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function parseTaskIdFromAutomaticCleaningFineDescription(description: string): string | null {
  const match = description.match(/Task ID:\s*([A-Za-z0-9_-]+)\./);
  return match?.[1] ?? null;
}

/**
 * Cancelled / voided / exempt automatic cleaning offences must not escalate later amounts.
 * Detects manager cancel-after-dispute status, dispute resolution text, and explicit exempt markers.
 */
export function isCancelledOrVoidedOrExemptFine(row: MissedFineSheetRow) {
  const status = String(row[FINE_STATUS_COLUMN] ?? "").toLowerCase();
  const dispute = String(row[FINE_DISPUTE_COLUMN] ?? "").toLowerCase();
  const description = String(row[FINE_DESCRIPTION_COLUMN] ?? "").toLowerCase();
  const content = String(row[FINE_CONTENT_COLUMN] ?? "").toLowerCase();

  if (dispute.includes("fine cancelled") || dispute.includes("cancelled fine")) {
    return true;
  }
  if (status.includes("hủy") || status.includes("hu\u1ef7") || status.includes("huy ")) {
    return true;
  }
  if (status.includes("cancel")) {
    return true;
  }
  // Mojibake / ASCII forms of "ĐÃ HỦY…"
  if (status.includes("huy sau") || status.includes("h\u00c3\u00bcy") || /\bhuy\b/.test(status)) {
    return true;
  }
  if (description.includes("[exempt]") || description.includes("fine exempt") || content.includes("[exempt]")) {
    return true;
  }
  if (description.includes("voided") || description.includes("[void]")) {
    return true;
  }
  return false;
}

export function toMissedFineOffence(row: MissedFineSheetRow): MissedFineOffence {
  const description = row[FINE_DESCRIPTION_COLUMN] ?? "";
  return {
    taskId: parseTaskIdFromAutomaticCleaningFineDescription(description),
    dutyDate: parseDutyDateFromAutomaticCleaningFineDescription(description),
    content: (row[FINE_CONTENT_COLUMN] ?? "").trim(),
    amount: parseFineAmount(row[FINE_AMOUNT_COLUMN]),
    row
  };
}

export function computeMissedCleaningFineAmount(input: {
  taskId: string;
  dutyDate: Date;
  content: string;
  /** All automatic cleaning fine rows for this resident (any month). */
  userAutomaticCleaningFines: MissedFineSheetRow[];
  /**
   * Other overdue duties not yet ticketed. Included so forward vs reverse
   * processing assigns the same amount (chain by duty date, then task id).
   */
  peerPendingDuties?: Array<{ taskId: string; dutyDate: Date; content: string }>;
}): number {
  const activeOffences = input.userAutomaticCleaningFines
    .filter((row) => isAutomaticCleaningFineRow(row))
    .filter((row) => !isCancelledOrVoidedOrExemptFine(row))
    .map(toMissedFineOffence)
    .filter((offence) => offence.taskId !== input.taskId);

  const peers = (input.peerPendingDuties ?? [])
    .filter((peer) => peer.taskId !== input.taskId)
    .filter((peer) => peer.content === input.content);

  type ChainItem = {
    taskId: string;
    dutyDate: Date;
    content: string;
    committedAmount: number | null;
  };

  const chain: ChainItem[] = [
    ...activeOffences
      .filter((offence) => offence.dutyDate != null)
      .map((offence) => ({
        taskId: offence.taskId ?? `row-${offence.amount}`,
        dutyDate: offence.dutyDate as Date,
        content: offence.content,
        committedAmount: offence.amount
      })),
    ...peers.map((peer) => ({
      taskId: peer.taskId,
      dutyDate: peer.dutyDate,
      content: peer.content,
      committedAmount: null as number | null
    })),
    {
      taskId: input.taskId,
      dutyDate: input.dutyDate,
      content: input.content,
      committedAmount: null
    }
  ];

  chain.sort((left, right) => {
    const dutyDiff = left.dutyDate.getTime() - right.dutyDate.getTime();
    if (dutyDiff !== 0) {
      return dutyDiff;
    }
    return left.taskId.localeCompare(right.taskId);
  });

  const seen = new Set<string>();
  const uniqueChain: ChainItem[] = [];
  for (const item of chain) {
    if (seen.has(item.taskId)) {
      continue;
    }
    seen.add(item.taskId);
    uniqueChain.push(item);
  }

  const resolvedAmounts = new Map<string, number>();

  for (let index = 0; index < uniqueChain.length; index += 1) {
    const item = uniqueChain[index];
    if (item.committedAmount != null) {
      resolvedAmounts.set(item.taskId, item.committedAmount);
      continue;
    }

    const priorSameErrorSameDutyMonth = uniqueChain
      .slice(0, index)
      .filter((prior) => prior.content === item.content)
      .filter((prior) => isSameUtcMonth(prior.dutyDate, item.dutyDate));

    // 15k only when this is the resident's first active automatic cleaning offence in the chain.
    const resolvedBase = index === 0 && activeOffences.length === 0 ? 15000 : 30000;

    let amount: number;
    if (priorSameErrorSameDutyMonth.length === 0) {
      amount = resolvedBase;
    } else if (priorSameErrorSameDutyMonth.length === 1) {
      amount = Math.round(resolvedBase * 1.5);
    } else {
      const latestPrior = priorSameErrorSameDutyMonth[priorSameErrorSameDutyMonth.length - 1];
      const latestAmount = resolvedAmounts.get(latestPrior.taskId) ?? latestPrior.committedAmount ?? resolvedBase;
      amount = Math.max(resolvedBase, latestAmount) * 2;
    }
    resolvedAmounts.set(item.taskId, amount);
  }

  return resolvedAmounts.get(input.taskId) ?? (activeOffences.length === 0 ? 15000 : 30000);
}
