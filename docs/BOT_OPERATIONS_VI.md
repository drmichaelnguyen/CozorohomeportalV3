# Cozoro Bot Runbook (Tiếng Việt)

Tài liệu này hướng dẫn vận hành bot sau khi đã nâng cấp cơ chế lưu tri thức thông minh.

## 1) Bot đang lưu tri thức ở đâu?

- Tri thức gốc: `/mnt/c/Users/User/Desktop/cozorohome webapp/Cozoro Knowledge.md`
- Tri thức học thêm: `/mnt/c/Users/User/Desktop/cozorohome webapp/bot/data/learned-qa.json`
- Dữ liệu train cho model nhỏ: `/mnt/c/Users/User/Desktop/cozorohome webapp/bot/data/router-training.json`
- Lịch sử chat thô: `/mnt/c/Users/User/Desktop/cozorohome webapp/bot/data/chat-history.jsonl`
- Trạng thái học/handoff: `/mnt/c/Users/User/Desktop/cozorohome webapp/bot/data/learning-state.json`

## 2) Luồng học tri thức an toàn

1. Tester/Admin chat trong playground hoặc fanpage.
2. Nếu cần sửa câu trả lời, dùng chế độ dạy bot (`asAdminCorrection`).
3. Dữ liệu mới sẽ vào trạng thái `pending` (chưa dùng cho RAG ngay).
4. Vào `/cozoro/dashboard` để `Approve` hoặc `Reject`.
5. Chỉ mục `approved` mới được đưa vào truy xuất tri thức.

Mục tiêu: tránh bot học nhầm thông tin chưa kiểm duyệt.

## 2b) Local tuning cho 2 model

- Model nhỏ `router` lấy ví dụ phân loại từ `router-training.json`.
- Model trả lời lấy ví dụ few-shot từ các mục `approved` do admin nhập ở trainer.
- Trang admin để dạy cả 2 lớp là `/cozoro/trainer`.

## 3) Dashboard quản trị

- Đăng nhập: `/cozoro/login`
- Dashboard: `/cozoro/dashboard`
- Trainer: `/cozoro/trainer`

Trong dashboard có:

- Danh sách hội thoại + tóm tắt tiếng Việt.
- Khung `Tri thức chờ duyệt`.
- Nút `Approve/Reject` cho từng mục học mới.

Trong trainer có:

- Form dạy `Question -> Answer` cho model trả lời.
- Form dạy `Message -> Decision/Route` cho model nhỏ.
- Danh sách ví dụ router gần đây.
- Có thể sửa hoặc xóa ví dụ router ngay trên web.

## 4) Kiểm tra nhanh bằng API

### Xem trạng thái học

```bash
curl http://127.0.0.1:4111/learning/status
```

Kết quả quan trọng:

- `approvedCount`: số mục đang được dùng cho RAG.
- `pendingCount`: số mục chờ duyệt.
- `rejectedCount`: số mục đã loại.

### Xem ví dụ tri thức học gần đây

```bash
curl "http://127.0.0.1:4111/learning/examples?limit=20"
```

### Làm mới index tri thức thủ công

```bash
curl -X POST http://127.0.0.1:4111/knowledge/refresh
```

## 5) Chiến lược tối ưu chất lượng trả lời

- Ưu tiên cập nhật đúng ở `Cozoro Knowledge.md` khi có thay đổi chính sách.
- Chỉ `Approve` các câu trả lời ổn định, dùng được lặp lại.
- Không `Approve` nội dung chửi bậy, mập mờ, hoặc chứa dữ liệu cá nhân.
- Duyệt `pending` hằng ngày để bot cải thiện liên tục nhưng vẫn an toàn.

## 6) Backup dữ liệu học để fine-tune sau này

Nên backup định kỳ 4 file:

- `bot/data/learned-qa.json`
- `bot/data/router-training.json`
- `bot/data/chat-history.jsonl`
- `bot/data/learning-state.json`

Gợi ý tối thiểu: backup mỗi ngày hoặc trước khi deploy thay đổi lớn.

## 7) Quy tắc bảo mật cần giữ

- Bot chỉ dành cho khách tiềm năng.
- Không tiết lộ thông tin định danh khách đang ở.
- Referral chỉ trả về `đủ điều kiện / không đủ điều kiện`.
- Giá trả lời là giá tham khảo, luôn nhắc khách liên hệ người thật để chốt cuối.
