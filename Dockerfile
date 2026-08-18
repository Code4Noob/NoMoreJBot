# ---- NoMoreJBot ----
FROM oven/bun:1

# ca-certificates 俾 HTTPS API 用。
# openvpn / iproute2 / procps / sudo：俾 bot 自己嘅 OpenVPN（scripts/vpn-connect.js）用
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openvpn \
    iproute2 \
    procps \
    sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# 確保 runtime 會寫嘅目錄存在（chat/history 同 log）
RUN mkdir -p chat/history log

# 可選：俾 URL crawler 工具（get_url_text_content）用 —— 會令 image 大好多
# RUN bunx playwright install --with-deps chromium

CMD ["bun", "run", "src/index.ts"]
