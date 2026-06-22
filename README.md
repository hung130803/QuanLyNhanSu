# 🎬 ReupManager — Quản lý team reup video

App quản lý team làm video reup (chuẩn bị TikTok Creator Rewards): quản lý **Key (kênh YouTube)**,
**nhân sự**, **năng suất video** và **lợi nhuận**.

---

## ▶️ CÁCH CHẠY (đơn giản nhất)

1. Mở thư mục `quan-ly-reup`.
2. **Double-click vào file `start.bat`**.
3. Trình duyệt tự mở trang đăng nhập. Xong!

> Lần đầu đăng nhập: **admin** / **admin123** → vào **Cài đặt** đổi mật khẩu ngay.

Cửa sổ đen (server) cứ **để mở**. Đóng nó = tắt app.

---

## 👥 CHO CẢ TEAM CÙNG XEM (chung 1 wifi/mạng công ty)

- Máy bạn (admin) bật `start.bat`.
- Các máy khác mở trình duyệt, gõ: **http://192.168.1.88:3000**
- Mỗi nhân sự đăng nhập bằng tài khoản bạn tạo cho họ ở mục **Nhân sự**.

> ⚠️ Địa chỉ `192.168.1.88` là IP máy bạn hôm nay. Nếu hôm khác không vào được,
> mở cmd gõ `ipconfig`, lấy dòng **IPv4 Address**, thay vào.

---

## 📋 CÁC TÍNH NĂNG

| Mục | Mô tả |
|---|---|
| **Tổng quan** | Dashboard: số key theo trạng thái, video hôm nay/tháng, biểu đồ 7 ngày, xếp hạng nhân sự, **tổng follow/tym TikTok**, lợi nhuận. |
| **Key YouTube** | Thêm kênh bằng link → **tự lấy tên + ảnh + mô tả + sub + 6 video gần đây**. Trạng thái: Chưa làm / Đang làm / Đợi duyệt / Đã xong. **Chống trùng** key. Nút 👁️ xem nội dung kênh. Xuất CSV. |
| **Kênh TikTok** | Thêm kênh reup bằng link → **tự lấy follow / tym / số video / ảnh / quốc gia**. Gắn key nguồn, giao nhân viên, trạng thái (đang chạy/nuôi/dừng/band). Nút 🔄 cập nhật số liệu mới. Tổng view nhập tay. Chống trùng. Xuất CSV. |
| **Nhật ký video** | Ghi mỗi người mỗi ngày làm bao nhiêu video, lọc theo ngày. |
| **Nhân sự** *(admin)* | Tạo/sửa/khóa tài khoản nhân viên. |
| **Lợi nhuận** *(admin)* | Ghi doanh thu / chi phí theo key, tự tính lợi nhuận. |
| **Cài đặt** | Đổi mật khẩu. |

### 🔄 Quy trình làm việc (workflow)
1. Ai tìm được **key YouTube** ngon → dán link vào mục **Key YouTube** (tự chống trùng).
2. Giao key cho nhân viên, đổi trạng thái khi làm.
3. Nhân viên tạo **kênh TikTok** reup → gắn với key nguồn → hệ thống theo dõi follow/tym.
4. Ghi **nhật ký video** mỗi ngày → dashboard tự thống kê năng suất.
5. Admin nhập **doanh thu/chi phí** → xem lợi nhuận.

### Phân quyền
- **Admin (bạn)**: thấy & quản lý tất cả.
- **Nhân sự**: chỉ thấy key chung, ghi video của mình. Không xem được lợi nhuận & quản lý nhân sự.

---

## 💾 DỮ LIỆU

Toàn bộ dữ liệu nằm trong file `data/reup.db`. **Sao lưu** = copy cả thư mục `data` ra chỗ khác.

---

## ❓ XỬ LÝ SỰ CỐ

- **Double-click không chạy**: cần cài [Node.js](https://nodejs.org) (máy bạn đã có sẵn).
- **Máy khác không vào được**: kiểm tra cùng wifi; tắt thử Windows Firewall hoặc cho phép Node.js; đảm bảo `start.bat` đang mở.
- **Tự lấy tên kênh không ra**: vẫn thêm được, bạn gõ tên tay hoặc sửa lại sau.

---

## 🚀 BƯỚC TIẾP THEO (khi cần)

Muốn cả team vào được **mọi lúc mọi nơi** (không cần máy bạn bật, không cần chung wifi) →
đưa app lên mạng (deploy lên Render/Railway miễn phí). Báo mình khi bạn muốn làm bước này.
