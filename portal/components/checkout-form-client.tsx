"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
import Link from "next/link";

type Step = 1 | 2 | 3 | 4 | 5;

type CheckoutContext = {
  eligible: boolean;
  reason?: string;
  kind?: "termination" | "contract_due";
  maHd?: string;
  name?: string;
  branch?: string;
  bed?: string;
  depositNote?: string;
  contractEndRaw?: string;
  daysUntilContractEnd?: number | null;
  completed?: boolean;
  submittedAt?: string;
};

const STEP_LABELS: Record<Step, string> = {
  1: "Hành lý & Dọn dẹp",
  2: "Chăn mền",
  3: "Khóa & Locker",
  4: "Ảnh giường & locker",
  5: "Hoàn cọc & lưu ý"
};

const GOOGLE_FORM_URL = process.env.NEXT_PUBLIC_CHECKOUT_GOOGLE_FORM_URL ?? "";

export function CheckoutFormClient() {
  const { sessionEmail } = usePortalSession();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [ctx, setCtx] = useState<CheckoutContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(true);

  const [luggageDone, setLuggageDone] = useState(false);
  const [beddingDone, setBeddingDone] = useState(false);
  const [keysDone, setKeysDone] = useState(false);
  const [readFinalNotes, setReadFinalNotes] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const [finalPhotos, setFinalPhotos] = useState<string[]>([]);
  const [optionalStepPhotos, setOptionalStepPhotos] = useState<Record<string, string[]>>({
    "1": [],
    "2": [],
    "3": []
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<{ step: "1" | "2" | "3" | "4" } | null>(null);

  const activeEmail = sessionEmail.trim().toLowerCase();

  useEffect(() => {
    if (!activeEmail) {
      setLoadingCtx(false);
      return;
    }
    let cancelled = false;
    setLoadingCtx(true);
    fetch(`${API_BASE_URL}/client/checkout-context?email=${encodeURIComponent(activeEmail)}`)
      .then((r) => r.json())
      .then((data: CheckoutContext) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => {
        if (!cancelled) setCtx({ eligible: false, reason: "load_error" });
      })
      .finally(() => {
        if (!cancelled) setLoadingCtx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEmail]);

  async function handlePhotoUpload(file: File, target: { step: "1" | "2" | "3" | "4" }) {
    if (!ctx?.maHd) return;
    setUploadingPhoto(true);
    try {
      const buffer = await file.arrayBuffer();
      const stepQ = target.step === "4" ? "" : `&step=${encodeURIComponent(target.step)}`;
      const res = await fetch(
        `${API_BASE_URL}/client/checkout/upload-photo?email=${encodeURIComponent(activeEmail)}&maHd=${encodeURIComponent(ctx.maHd)}&filename=${encodeURIComponent(file.name)}${stepQ}`,
        { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: buffer }
      );
      const data = (await res.json()) as { ok?: boolean; fileName?: string; error?: string };
      if (!res.ok || !data.fileName) throw new Error(data.error ?? "Upload failed");
      if (target.step === "4") {
        setFinalPhotos((prev) => [...prev, data.fileName!]);
      } else {
        setOptionalStepPhotos((prev) => ({
          ...prev,
          [target.step]: [...(prev[target.step] ?? []), data.fileName!]
        }));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhoto(false);
      uploadTargetRef.current = null;
    }
  }

  function openPhotoPicker(target: { step: "1" | "2" | "3" | "4" }) {
    uploadTargetRef.current = target;
    photoInputRef.current?.click();
  }

  async function handleSubmit() {
    if (!ctx?.maHd || !ctx.kind) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/client/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          maHd: ctx.maHd,
          source: ctx.kind,
          steps: {
            luggage: luggageDone,
            bedding: beddingDone,
            keys: keysDone,
            photoNote,
            optionalStepPhotos
          },
          photos: finalPhotos
        })
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setDone(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to submit check-out");
    } finally {
      setLoading(false);
    }
  }

  function PhotoPickerBlock({
    label,
    target,
    files
  }: {
    label: string;
    target: { step: "1" | "2" | "3" };
    files: string[];
  }) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <button
          type="button"
          disabled={uploadingPhoto}
          onClick={() => {
            uploadTargetRef.current = target;
            photoInputRef.current?.click();
          }}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploadingPhoto ? "Đang upload…" : "📷 Chụp / chọn ảnh (khuyến nghị)"}
        </button>
        {files.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-emerald-700">
            {files.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2">
                <span className="truncate">✓ {p}</span>
                <button
                  type="button"
                  className="shrink-0 text-rose-600 hover:underline"
                  onClick={() => {
                    setOptionalStepPhotos((prev) => ({
                      ...prev,
                      [target.step]: (prev[target.step] ?? []).filter((x) => x !== p)
                    }));
                  }}
                >
                  Xóa
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-slate-400">Không bắt buộc (trừ bước 4)</p>
        )}
      </div>
    );
  }

  if (loadingCtx) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-sm text-slate-500">Đang tải…</div>
      </div>
    );
  }

  if (!activeEmail) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-slate-600">Vui lòng đăng nhập để xem quy trình trả phòng.</p>
        <Link href="/client-login" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Đăng nhập
        </Link>
      </div>
    );
  }

  if (!ctx?.eligible) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="text-4xl">🏠</div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Chưa có quy trình trả phòng</h2>
        <p className="mt-2 text-sm text-slate-600">
          {ctx?.reason === "contract_not_due_yet"
            ? `Hợp đồng của bạn chưa đến kỳ trả phòng trên cổng (còn ${ctx.daysUntilContractEnd ?? "—"} ngày). Khi còn tối đa 7 ngày trước ngày hết hạn, nút Check-out sẽ xuất hiện ở trang tài khoản.`
            : "Bạn không có yêu cầu check-out đang mở (chấm dứt hợp đồng hoặc sắp hết hạn trong 7 ngày). Nếu cần hỗ trợ, vui lòng liên hệ quản lý."}
        </p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Về trang chủ
        </Link>
      </div>
    );
  }

  if (ctx.completed || done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-3xl">✓</div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Đã hoàn tất check-out</h2>
        <p className="mt-2 text-sm text-slate-600">
          Cảm ơn bạn đã hoàn thành các bước. Ảnh được lưu trên máy chủ Cozoro; thông tin đã được ghi nhận (và đẩy lên Google Sheet nếu cấu hình đúng).
        </p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Về trang chủ
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8 px-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Check-out</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Quy trình Trả phòng</h1>
        <p className="mt-2 text-sm text-amber-900/90 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          Vui lòng hoàn tất các bước trước <strong>12:00 PM</strong> để chúng tôi kịp chuẩn bị giường cho khách tiếp theo.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {ctx.name} · Giường {ctx.bed} · {ctx.branch}
          {ctx.kind === "contract_due" && ctx.contractEndRaw ? (
            <span className="block text-xs text-slate-500">Ngày hết hạn HĐ: {ctx.contractEndRaw}</span>
          ) : null}
        </p>
        {ctx.depositNote ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">⚠️ {ctx.depositNote}</div>
        ) : null}
      </div>

      <div className="flex gap-1">
        {([1, 2, 3, 4, 5] as Step[]).map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              s < step ? "bg-emerald-500" : s === step ? "bg-slate-900" : "bg-slate-200"
            }`}
          />
        ))}
      </div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Bước {step}/5 — {STEP_LABELS[step]}
      </p>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const t = uploadTargetRef.current;
          if (file && t) void handlePhotoUpload(file, t);
          e.target.value = "";
        }}
      />

      {step === 1 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 1: Kiểm tra hành lý &amp; Dọn dẹp cá nhân</h2>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Tư trang:</strong> Kiểm tra kỹ khu vực đầu giường, dưới gối và trong tủ Locker (đặc biệt là sạc điện thoại, hộ chiếu, ví tiền).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Rác thải:</strong> Vui lòng thu gom rác cá nhân và bỏ vào thùng rác chung tại hành lang.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Thiết bị điện:</strong> Tắt đèn đọc sách tại giường và các thiết bị điện không cần thiết.
              </span>
            </li>
          </ul>
          <PhotoPickerBlock label="Ảnh minh chứng bước 1 (nếu có)" target={{ step: "1" }} files={optionalStepPhotos["1"] ?? []} />
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <input
              type="checkbox"
              checked={luggageDone}
              onChange={(e) => setLuggageDone(e.target.checked)}
              className="h-5 w-5 rounded border-emerald-400 accent-emerald-600"
            />
            <span className="text-sm font-medium text-emerald-800">Tôi đã hoàn thành bước này</span>
          </label>
          <button
            type="button"
            disabled={!luggageDone}
            onClick={() => setStep(2)}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Tiếp theo →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 2: Xử lý chăn mền</h2>
          <p className="text-sm text-slate-600">Để đảm bảo vệ sinh, bạn vui lòng giúp chúng tôi một tay:</p>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Thực hiện:</strong> Tháo vỏ gối, vỏ chăn và ga giường.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Vị trí:</strong> Bỏ tất cả đồ vải bẩn vào giỏ giặt tại Khu vực phòng giặt.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Lưu ý:</strong> Giữ lại ruột gối và ruột chăn ngay ngắn trên giường.
              </span>
            </li>
          </ul>
          <PhotoPickerBlock label="Ảnh minh chứng bước 2 (nếu có)" target={{ step: "2" }} files={optionalStepPhotos["2"] ?? []} />
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <input
              type="checkbox"
              checked={beddingDone}
              onChange={(e) => setBeddingDone(e.target.checked)}
              className="h-5 w-5 rounded border-emerald-400 accent-emerald-600"
            />
            <span className="text-sm font-medium text-emerald-800">Tôi đã hoàn thành bước này</span>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">
              ← Quay lại
            </button>
            <button
              type="button"
              disabled={!beddingDone}
              onClick={() => setStep(3)}
              className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Tiếp theo →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 3: Bàn giao khóa &amp; Tủ Locker</h2>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Khóa từ / Chìa khóa:</strong> Để lại chìa khóa tại <strong>vị trí cũ</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>Đảm bảo tủ Locker đã được dọn sạch và không còn khóa cá nhân.</span>
            </li>
          </ul>
          <PhotoPickerBlock label="Ảnh minh chứng bước 3 (nếu có)" target={{ step: "3" }} files={optionalStepPhotos["3"] ?? []} />
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <input
              type="checkbox"
              checked={keysDone}
              onChange={(e) => setKeysDone(e.target.checked)}
              className="h-5 w-5 rounded border-emerald-400 accent-emerald-600"
            />
            <span className="text-sm font-medium text-emerald-800">Tôi đã hoàn thành bước này</span>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">
              ← Quay lại
            </button>
            <button
              type="button"
              disabled={!keysDone}
              onClick={() => setStep(4)}
              className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Tiếp theo →
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 4: Xác nhận hoàn tất (Online)</h2>
          <p className="text-sm text-slate-600">
            Chụp ảnh giường và locker sau khi đã dọn đồ. Ngoài ra, gửi ảnh qua Google Form với nội dung tương tự:{" "}
            <strong>{`Check-out - Giường ${ctx.bed} - ${ctx.name}`}</strong>
          </p>
          {GOOGLE_FORM_URL ? (
            <a
              href={GOOGLE_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-semibold text-sky-700 underline"
            >
              Mở Google Form gửi ảnh →
            </a>
          ) : (
            <p className="text-xs text-slate-500">Quản lý sẽ gửi link Google Form qua tin nhắn nếu chưa có tại đây.</p>
          )}
          <div>
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={() => openPhotoPicker({ step: "4" })}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploadingPhoto ? "Đang upload…" : "📷 Upload ảnh giường & locker (bắt buộc)"}
            </button>
            {finalPhotos.length > 0 && (
              <ul className="mt-3 space-y-1">
                {finalPhotos.map((p, i) => (
                  <li key={p} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    <span>✓ Ảnh {i + 1}</span>
                    <button type="button" onClick={() => setFinalPhotos((prev) => prev.filter((x) => x !== p))} className="text-rose-500">
                      Xóa
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <textarea
            value={photoNote}
            onChange={(e) => setPhotoNote(e.target.value)}
            placeholder="Ghi chú thêm nếu có (không bắt buộc)"
            rows={2}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(3)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">
              ← Quay lại
            </button>
            <button
              type="button"
              disabled={finalPhotos.length === 0}
              onClick={() => setStep(5)}
              className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Tiếp theo →
            </button>
          </div>
          {finalPhotos.length === 0 ? <p className="text-center text-xs text-slate-400">Cần ít nhất 1 ảnh để tiếp tục</p> : null}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 5: Hoàn cọc &amp; lưu ý</h2>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>Hoàn cọc:</strong> Tiền cọc (nếu có) sẽ được chuyển hoàn vào số tài khoản của bạn trong vòng{" "}
                <strong>30–60 phút</strong> sau khi chúng tôi xác nhận tình trạng giường.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-amber-500">💡</span>
              <span>
                <strong>Gửi đồ sau khi check-out:</strong> Nếu bạn có chuyến bay muộn, có khu vực gửi đồ miễn phí — vui lòng nhắn tin quản lý để được hướng dẫn vị trí cụ thể.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-rose-500">•</span>
              <span>
                <strong>Check-out trễ:</strong> Mỗi giờ trễ sau 12:00 PM có thể phát sinh phí (theo chính sách chi nhánh; tối đa đến 15:00, sau đó có thể tính thêm 1 ngày lưu trú). Hoàn tất trước 12:00 PM giúp kịp chuẩn bị giường.
              </span>
            </li>
          </ul>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={readFinalNotes}
              onChange={(e) => setReadFinalNotes(e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-slate-400 accent-slate-900"
            />
            <span className="text-sm text-slate-700">Tôi đã đọc và hiểu các lưu ý trên.</span>
          </label>
          {message ? <p className="text-sm font-medium text-rose-600">{message}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(4)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">
              ← Quay lại
            </button>
            <button
              type="button"
              disabled={loading || !readFinalNotes}
              onClick={() => void handleSubmit()}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {loading ? "Đang gửi…" : "✓ Gửi hoàn tất check-out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
