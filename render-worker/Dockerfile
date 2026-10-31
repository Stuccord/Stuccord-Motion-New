# The render worker as a Docker service (render.yaml: runtime docker, build
# context = the repository root, so the graphics can be built from the app's
# src/motion).
#
# Debian with the system libraries Remotion's headless Chrome needs (from
# https://www.remotion.dev/docs/miscellaneous/linux-dependencies), and a
# system font for captions when no brand font is picked. ffmpeg comes from
# the ffmpeg-static package, as before.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-dejavu-core \
    libnss3 libdbus-1-3 libatk1.0-0 libasound2 libxrandr2 libxkbcommon-dev \
    libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 libcairo2 \
    libpango-1.0-0 libatk-bridge2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/render-worker

COPY render-worker/package.json render-worker/package-lock.json ./
# The speaker cut-out runs on the processor: skip onnxruntime-node's
# download of the NVIDIA (CUDA) libraries.
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm ci --omit=dev

COPY render-worker/ ./
# The graphics are drawn by the app's own composition.
COPY src/motion /app/src/motion
# Bundles the graphics and downloads the headless Chrome into the image.
RUN node build-graphics.mjs

ENV NODE_ENV=production
CMD ["node", "server.js"]
