# The reference backend: taskflow-server, Node + SQLite, one process.
# Build from the repo root, so the image carries the same domain core as the app:
#   docker build -t taskflow-server .
#   docker run -p 8080:8080 -v taskflow-data:/data -e TZ=Europe/London taskflow-server

FROM node:22-slim

# tzdata so TZ (the home timezone, which sets day boundaries) resolves.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080

# Only the server's runtime dependency (ws); the app's build tools are devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The domain core and what it imports, the core-version script, the server.
COPY src/core src/core
COPY src/lib src/lib
COPY scripts/core-version.mjs scripts/core-version.mjs
COPY server server

RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/server/cli.js "$@"\n' > /usr/local/bin/taskflow-server \
 && chmod +x /usr/local/bin/taskflow-server

VOLUME /data
EXPOSE 8080
CMD ["taskflow-server", "serve"]
