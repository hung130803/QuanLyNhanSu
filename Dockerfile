# Dockerfile — đóng gói app để chạy trên Fly.io
FROM node:20-bookworm-slim

# Công cụ build cho better-sqlite3 (phòng khi không có bản dựng sẵn)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài thư viện trước (tận dụng cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy mã nguồn
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
# Dữ liệu lưu vào ổ đĩa bền gắn ở /data
ENV DATA_DIR=/data

EXPOSE 8080
CMD ["node", "server.js"]
