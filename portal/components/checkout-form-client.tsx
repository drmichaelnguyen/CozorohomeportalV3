"use client";

import { useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
import Link from "next/link";

type Step = 1 | 2 | 3 | 4;

type TerminationRecord = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  terminatedAt: string;
  depositNote: string;
  checkOut: { submittedAt: string } | null;
};

const STEP_LABELS: Record<Step, string> = {
  1: "Hành lý & Dọn dẹp",
  2: "Chăn mền",
  3: "Khóa & Tủ Locker",
  4: "Xác nhận & Ảnh"
};

export function CheckoutFormClient() {
  const { sessionEmail } = usePortalSession();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [termination, setTermination] = useState<TerminationRecord | null>(null);
  const [loadingTermination, setLoadingTermination] = useState(true);

  // Step confirmations
  const [luggageDone, setLuggageDone] = useState(false);
  const [beddingDone, setBeddingDone] = useState(false);
  const [keysDone, setKeysDone] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const activeEmail = sessionEmail.trim().toLowerCase();

  // Load termination record
  useState(() => {
    if (!activeEmail) return;
    setLoadingTermination(true);
    fetch(`${API_BASE_URL}/client/termination-status?email=${encodeURIComponent(activeEmail)}`)
      .then((r) => r.json())
      .then((data: { record?: TerminationRecord | null }) => {
        setTermination(data.record ?? null);
      })
      .catch(() => setTermination(null))
      .finally(() => setLoadingTermination(false));
  });

  async function handlePhotoUpload(file: File) {
    if (!termination) return;
    setUploadingPhoto(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(
        `${API_BASE_URL}/client/checkout/upload-photo?email=${encodeURIComponent(activeEmail)}&maHd=${encodeURIComponent(termination.maHd)}&filename=${encodeURIComponent(file.name)}`,
        { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: buffer }
      );
      const data = (await res.json()) as { ok?: boolean; fileName?: string; error?: string };
      if (!res.ok || !data.fileName) throw new Error(data.error ?? "Upload failed");
      setUploadedPhotos((prev) => [...prev, data.fileName!]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit() {
    if (!termination) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/client/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          maHd: termination.maHd,
          steps: { luggage: luggageDone, bedding: beddingDone, keys: keysDone, photoNote },
          photos: uploadedPhotos
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

  if (loadingTermination) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  if (!termination) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="text-4xl">🏠</div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">No active check-out</h2>
        <p className="mt-2 text-sm text-slate-600">
          You don&apos;t have an active contract termination. If you think this is a mistake, please contact your manager.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (termination.checkOut || done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-3xl">✓</div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Check-out complete!</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your check-out has been submitted successfully. Thank you for staying at Cozoro Home.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8 px-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Check-out</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Thủ tục trả phòng</h1>
        <p className="mt-1 text-sm text-slate-500">
          {termination.name} · Giường {termination.bed} · {termination.branch}
        </p>
        {termination.depositNote && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠️ {termination.depositNote}
          </div>
        )}
      </div>

      {/* Step progress */}
      <div className="flex gap-1">
        {([1, 2, 3, 4] as Step[]).map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              s < step ? "bg-emerald-500" : s === step ? "bg-slate-900" : "bg-slate-200"
            }`}
          />
        ))}
      </div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Bước {step}/4 — {STEP_LABELS[step]}
      </p>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 1: Kiểm tra hành lý & Dọn dẹp cá nhân</h2>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Tư trang:</strong> Kiểm tra kỹ khu vực đầu giường, dưới gối và trong tủ Locker (đặc biệt là sạc điện thoại, hộ chiếu, ví tiền).</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Rác thải:</strong> Vui lòng thu gom rác cá nhân và bỏ vào thùng rác chung tại hành lang.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Thiết bị điện:</strong> Tắt đèn đọc sách tại giường và các thiết bị điện không cần thiết.</span>
            </li>
          </ul>
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

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 2: Xử lý chăn mền</h2>
          <p className="text-sm text-slate-600">Để đảm bảo vệ sinh, bạn vui lòng giúp chúng tôi một tay:</p>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Thực hiện:</strong> Tháo vỏ gối, vỏ chăn và ga giường.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Vị trí:</strong> Bỏ tất cả đồ vải bẩn vào giỏ giặt tại Khu vực phòng giặt.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Lưu ý:</strong> Giữ lại ruột gối và ruột chăn ngay ngắn trên giường.</span>
            </li>
          </ul>
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
            <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">← Quay lại</button>
            <button type="button" disabled={!beddingDone} onClick={() => setStep(3)} className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40">Tiếp theo →</button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 3: Bàn giao khóa & Tủ Locker</h2>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span><strong>Khóa từ / Chìa khóa:</strong> Để lại chìa khóa tại vị trí cũ (thường là bàn lễ tân hoặc móc khóa tại phòng).</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-slate-400">•</span>
              <span>Đảm bảo tủ Locker đã được dọn sạch và không còn khóa cá nhân.</span>
            </li>
          </ul>
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
            <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">← Quay lại</button>
            <button type="button" disabled={!keysDone} onClick={() => setStep(4)} className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40">Tiếp theo →</button>
          </div>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Bước 4: Xác nhận hoàn tất</h2>
          <p className="text-sm text-slate-600">
            Chụp ảnh giường và tủ Locker sau khi đã dọn đồ, sau đó upload bên dưới.
          </p>
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="flex gap-2"><span className="mt-0.5 text-slate-400">•</span><span>Chụp ảnh giường của bạn sau khi dọn đồ.</span></li>
            <li className="flex gap-2"><span className="mt-0.5 text-slate-400">•</span><span>Chụp ảnh tủ Locker (đã mở và trống).</span></li>
          </ul>

          {/* Photo upload */}
          <div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handlePhotoUpload(file);
              }}
            />
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={() => photoInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploadingPhoto ? "Đang upload..." : "📷 Chọn ảnh để upload"}
            </button>
            {uploadedPhotos.length > 0 && (
              <div className="mt-3 space-y-1">
                {uploadedPhotos.map((p, i) => (
                  <div key={p} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    <span>✓ Ảnh {i + 1} đã upload</span>
                    <button
                      type="button"
                      onClick={() => setUploadedPhotos((prev) => prev.filter((x) => x !== p))}
                      className="text-rose-500 hover:text-rose-700"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <textarea
            value={photoNote}
            onChange={(e) => setPhotoNote(e.target.value)}
            placeholder="Ghi chú thêm nếu có (không bắt buộc)"
            rows={2}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />

          {message && <p className="text-sm font-medium text-rose-600">{message}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(3)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700">← Quay lại</button>
            <button
              type="button"
              disabled={loading || uploadedPhotos.length === 0}
              onClick={() => void handleSubmit()}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {loading ? "Đang gửi..." : "✓ Hoàn tất check-out"}
            </button>
          </div>
          {uploadedPhotos.length === 0 && (
            <p className="text-center text-xs text-slate-400">Vui lòng upload ít nhất 1 ảnh để hoàn tất</p>
          )}
        </div>
      )}
    </div>
  );
}
