"use client";

import { formatCozoroDate, formatCozoroDateTime } from "../lib/date-format";

export const FINE_TIMESTAMP_COLUMN = "DẤU THỜI GIAN";
export const FINE_TIMESTAMP_COLUMN_TITLE = "Dấu thời gian";
export const FINE_TIMESTAMP_COLUMN_TYPO = "ĐẤU THỜI GIAN";
export const FINE_CREATED_AT_COLUMN = "THỜI ĐIỂM LẬP PHIẾU";
export const FINE_EMAIL_COLUMN = "EMAIL";
export const FINE_AMOUNT_COLUMN = "CHI PHÍ THANH TOÁN CHO VI PHẠM";
export const FINE_STATUS_COLUMN = "ĐÃ THANH TOÁN?";
export const FINE_CONTENT_COLUMN = "NỘI DUNG VI PHẠM";
export const FINE_DESCRIPTION_COLUMN = "MÔ TẢ VI PHẠM";
export const FINE_DUE_COLUMN = "HẠN THANH TOÁN";
export const FINE_DISPUTE_COLUMN = "Khieu nai tu khach hang";
export const FINE_IMAGE_COLUMN = "HÌNH ẢNH";
export const FINE_LOCATION_COLUMN = "VỊ TRÍ PHÁT HIỆN VI PHẠM";
export const FINE_CREATOR_COLUMN = "NGƯỜI LẬP PHIẾU";

type Language = "en" | "vi";

function pickRowValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

/** Violation / incident time stored in DẤU THỜI GIAN (not ticket issue time). */
export function getFineViolationRaw(row: Record<string, string>) {
  return pickRowValue(row, [FINE_TIMESTAMP_COLUMN, FINE_TIMESTAMP_COLUMN_TYPO, FINE_TIMESTAMP_COLUMN_TITLE]);
}

/** Ticket issue / created time stored in THỜI ĐIỂM LẬP PHIẾU. */
export function getFineIssuedRaw(row: Record<string, string>) {
  return pickRowValue(row, [FINE_CREATED_AT_COLUMN]);
}

export function getFineTimestampKey(row: Record<string, string>) {
  return getFineViolationRaw(row) || getFineIssuedRaw(row);
}

export function isFineRowMarkedPaid(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (
    normalized === "chưa" ||
    normalized.startsWith("chưa ") ||
    normalized === "chua" ||
    normalized.startsWith("chua ") ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "không" ||
    normalized === "khong"
  ) {
    return false;
  }
  return true;
}

function formatFineDate(value: string | null | undefined, withTime: boolean) {
  if (!value?.trim()) {
    return "—";
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return withTime ? formatCozoroDateTime(parsed) : formatCozoroDate(parsed);
  }
  return value.trim();
}

export function FineEvidencePreview({ url }: { url: string }) {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const driveId = trimmed.match(/\/file\/d\/([^/]+)/)?.[1];
  if (driveId) {
    return (
      <div className="mt-2 aspect-video w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-black">
        <iframe
          title="Fine evidence"
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          className="h-full w-full"
          allowFullScreen
        />
      </div>
    );
  }

  const lower = trimmed.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/.test(lower)) {
    return <img src={trimmed} alt="" className="mt-2 max-h-56 rounded-lg object-contain" />;
  }
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) {
    return <video src={trimmed} controls className="mt-2 max-h-56 w-full rounded-lg bg-black" />;
  }

  return null;
}

function DetailField({
  label,
  children,
  className = ""
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

type FineTicketDetailsProps = {
  row: Record<string, string>;
  parsedTimestamp?: string | null;
  parsedDueDate?: string | null;
  language: Language;
  /** Staff / owner / host only — never show to residents. */
  showIssuer?: boolean;
  /** Compact account-preview layout. */
  compact?: boolean;
  showEvidence?: boolean;
};

export function FineTicketDetails({
  row,
  parsedTimestamp = null,
  parsedDueDate = null,
  language,
  showIssuer = false,
  compact = false,
  showEvidence = true
}: FineTicketDetailsProps) {
  const vi = language === "vi";
  const content = pickRowValue(row, [FINE_CONTENT_COLUMN]) || "—";
  const description = pickRowValue(row, [FINE_DESCRIPTION_COLUMN]);
  const location = pickRowValue(row, [FINE_LOCATION_COLUMN]);
  const amount = pickRowValue(row, [FINE_AMOUNT_COLUMN]) || "—";
  const statusRaw = pickRowValue(row, [FINE_STATUS_COLUMN]);
  const paid = isFineRowMarkedPaid(statusRaw);
  const image = pickRowValue(row, [FINE_IMAGE_COLUMN]);
  const issuer = pickRowValue(row, [FINE_CREATOR_COLUMN]);
  const violationRaw = getFineViolationRaw(row);
  const issuedRaw = getFineIssuedRaw(row);
  const dueRaw = pickRowValue(row, [FINE_DUE_COLUMN]);

  const violationLabel = vi ? "Ngày vi phạm" : "Violation date";
  const issuedLabel = vi ? "Ngày lập phiếu" : "Ticket issued";
  const dueLabel = vi ? "Hạn thanh toán" : "Payment due";
  const contentLabel = vi ? "Nội dung vi phạm" : "Violation";
  const descriptionLabel = vi ? "Mô tả" : "Details";
  const locationLabel = vi ? "Vị trí phát hiện" : "Location found";
  const amountLabel = vi ? "Chi phí" : "Amount";
  const statusLabel = vi ? "Trạng thái" : "Status";
  const evidenceLabel = vi ? "Ảnh / video minh chứng" : "Photo / video evidence";
  const issuerLabel = vi ? "Người lập phiếu" : "Issued by";
  const paidLabel = vi ? "Đã thanh toán" : "Paid";
  const unpaidLabel = vi ? "Chưa thanh toán" : "Unpaid";

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3 font-medium text-slate-900">
          <span>{content}</span>
          <span className="shrink-0 text-red-600">{amount}</span>
        </div>
        <div className="space-y-0.5 text-xs text-slate-500">
          <div>
            <span className="font-medium text-slate-600">{violationLabel}:</span>{" "}
            {formatFineDate(parsedTimestamp || violationRaw, false)}
          </div>
          {issuedRaw ? (
            <div>
              <span className="font-medium text-slate-600">{issuedLabel}:</span>{" "}
              {formatFineDate(issuedRaw, false)}
            </div>
          ) : null}
          {description ? <div className="text-slate-600">{description}</div> : null}
          {location ? (
            <div>
              <span className="font-medium text-slate-600">{locationLabel}:</span> {location}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className={paid ? "font-medium text-green-600" : "font-medium text-amber-600"}>
            {paid ? paidLabel : unpaidLabel}
          </span>
          {showIssuer && issuer ? (
            <span className="text-slate-500">
              {issuerLabel}: {issuer}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <DetailField label={violationLabel}>
        {formatFineDate(parsedTimestamp || violationRaw, true)}
      </DetailField>
      <DetailField label={issuedLabel}>{formatFineDate(issuedRaw, true)}</DetailField>
      <DetailField label={dueLabel}>
        {formatFineDate(parsedDueDate || dueRaw, true)}
      </DetailField>
      <DetailField label={amountLabel}>{amount}</DetailField>
      <DetailField label={contentLabel}>{content}</DetailField>
      <DetailField label={statusLabel}>{statusRaw || (paid ? paidLabel : unpaidLabel)}</DetailField>
      <DetailField label={descriptionLabel} className="md:col-span-2">
        {description || "—"}
      </DetailField>
      <DetailField label={locationLabel}>{location || "—"}</DetailField>
      {showIssuer ? <DetailField label={issuerLabel}>{issuer || "—"}</DetailField> : null}
      {showEvidence ? (
        <div className="md:col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{evidenceLabel}</div>
          {image ? (
            <div className="mt-1">
              <a
                href={image}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm font-medium text-sky-700 underline"
              >
                {image}
              </a>
              <FineEvidencePreview url={image} />
            </div>
          ) : (
            <div className="mt-1 text-sm text-slate-500">—</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
