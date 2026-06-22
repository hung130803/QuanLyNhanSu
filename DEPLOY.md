# 🚀 Hướng dẫn đưa ReupManager lên web (Fly.io + GitHub)

Mục tiêu: app chạy online 24/7, ai ở đâu cũng vào được, **miễn phí**, và **mỗi lần sửa code là tự cập nhật**.

> Mọi file cấu hình đã được chuẩn bị sẵn. Bạn chỉ cần làm theo các bước dưới.
> Gặp lỗi ở bước nào cứ chụp lại báo mình, mình xử lý cùng bạn.

---

## PHẦN A — Đưa code lên GitHub (lưu trữ code)

### A1. Tạo tài khoản GitHub (nếu chưa có)
- Vào https://github.com/signup → đăng ký (miễn phí).

### A2. Tạo kho chứa code (repository)
- Vào https://github.com/new
- **Repository name**: `quan-ly-reup` (hoặc tên bạn thích)
- Chọn **Private** (riêng tư — không ai xem được code của bạn)
- **KHÔNG** tích "Add a README" (vì đã có sẵn)
- Bấm **Create repository**

### A3. Đẩy code lên (mình sẽ làm giúp)
Sau khi tạo repo xong, báo mình tên đăng nhập GitHub của bạn. Mình sẽ giúp cài công cụ
và đẩy code lên. Hoặc bạn tự chạy (thay `TEN_GITHUB` bằng tên của bạn):
```
git remote add origin https://github.com/TEN_GITHUB/quan-ly-reup.git
git push -u origin main
```
(Lần đầu push sẽ hỏi đăng nhập GitHub.)

---

## PHẦN B — Đưa app chạy trên Fly.io (host miễn phí)

### B1. Tạo tài khoản Fly.io
- Vào https://fly.io/app/sign-up → đăng ký (nên đăng nhập bằng GitHub cho nhanh).
- Fly yêu cầu thêm **thẻ Visa/Mastercard để xác minh** — **không bị trừ tiền** trong mức free.

### B2. Cài công cụ Fly (flyctl) trên máy
Mở **PowerShell** và chạy:
```
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```
Đóng và mở lại PowerShell sau khi cài.

### B3. Đăng nhập + tạo app
Trong thư mục `D:\claude\quan-ly-reup`, chạy lần lượt:
```
fly auth login
fly launch --no-deploy
```
- Khi `fly launch` hỏi: **giữ nguyên cấu hình có sẵn (Yes)**.
- Nếu báo tên `reupmanager` đã bị dùng → đặt tên khác (vd `reup-cuaban-123`).

### B4. Tạo ổ đĩa lưu dữ liệu (để KHÔNG mất dữ liệu)
```
fly volumes create reup_data --region sin --size 1
```

### B5. Đặt mật khẩu admin an toàn (QUAN TRỌNG)
```
fly secrets set ADMIN_PASSWORD="matkhau-that-manh-cua-ban"
```

### B6. Deploy lần đầu
```
fly deploy
```
Xong! Fly sẽ cho bạn 1 đường link dạng `https://ten-app.fly.dev` — đó là địa chỉ web của bạn.

---

## PHẦN C — Tự động cập nhật mỗi khi sửa code

### C1. Lấy mã token của Fly
```
fly tokens create deploy
```
Copy đoạn mã hiện ra.

### C2. Dán token vào GitHub
- Vào repo trên GitHub → **Settings** → **Secrets and variables** → **Actions**
- Bấm **New repository secret**
- **Name**: `FLY_API_TOKEN`
- **Secret**: dán đoạn mã ở B... à C1 vào
- **Add secret**

### C3. Xong!
Từ giờ, mỗi khi mình (hoặc bạn) sửa code và đẩy lên GitHub (`git push`), app sẽ **tự động
cập nhật phiên bản mới nhất** lên web sau 1-2 phút. Không phải làm gì thêm.

---

## ⚠️ Lưu ý quan trọng
- **Đổi mật khẩu admin** ngay (đã đặt ở B5, hoặc vào mục Cài đặt trong app đổi tiếp).
- Dữ liệu cũ trên máy bạn (đang test) **không tự chuyển lên** — bản trên web bắt đầu trống.
  Cứ tạo lại tài khoản nhân viên + thêm key là dùng được. (Muốn chuyển dữ liệu cũ lên thì
  báo mình, hơi kỹ thuật một chút.)
- App miễn phí sẽ "ngủ" khi không ai dùng và tự thức dậy khi có người vào (chậm ~5 giây lần đầu).
