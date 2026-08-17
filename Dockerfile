# ---- NoMoreJBot ----
FROM node:22-slim

# 原生模組（sqlite3）可能要 build tools；ca-certificates 俾 HTTPS API 用。
# openvpn / iproute2 / procps / sudo：俾 bot 自己嘅 OpenVPN（scripts/vpn-connect.js）用
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    openvpn \
    iproute2 \
    procps \
    sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pnpm 11 對應 repo 嘅 lockfileVersion 9.0，需要 Node 22+
RUN npm install -g pnpm@11

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm ci --frozen-lockfile

COPY . .

# 打包成 dist/index.js（esbuild）
RUN npm run build

# 確保 runtime 會寫嘅目錄存在（chat/history 同 log）
RUN mkdir -p chat/history log

# 可選：俾 URL crawler 工具（get_url_text_content）用 —— 會令 image 大好多
# RUN npx playwright install --with-deps chromium

CMD ["npm", "run", "start"]
