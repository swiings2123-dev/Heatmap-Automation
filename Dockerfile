# Heatmap collector + dashboard, with Chromium for page screenshots.
# Node 24 on purpose: same as local dev.
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Toolchain for native modules (better-sqlite3 compiles from source when no prebuilt binary matches).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Dev deps are needed to build the dashboard/tracker (vite, tailwind, typescript).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Chromium + its system libraries, at the exact version the installed playwright package expects.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATA_DIR=/var/data \
    TRUST_PROXY=true

EXPOSE 10000
# One process is enough: the server also auto-captures screenshots
# (first traffic per page/device + a re-check every CAPTURE_INTERVAL_HOURS).
CMD ["npm", "start"]
