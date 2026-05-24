FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      chromium \
      fonts-liberation \
      git \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnss3 \
      libnspr4 \
      libpango-1.0-0 \
      libu2f-udev \
      libx11-6 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxkbcommon-x11-0 \
      libxrandr2 \
      libxshmfence1 \
      libxcb1 \
      pkg-config \
      python3 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /ms-playwright \
    && chown -R node:node /ms-playwright
