# Heatmap collector + dashboard, with Chromium for page screenshots.
# The Playwright base image ships the browser + system libs; its tag MUST match
# the "playwright" version in package-lock.json (currently 1.65.1).
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app

# Dev deps are needed to build the dashboard/tracker (vite, tailwind, typescript).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

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
