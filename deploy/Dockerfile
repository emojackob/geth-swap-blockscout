FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY deploy.mjs ./
COPY artifacts ./artifacts
CMD ["sh", "-c", "mkdir -p /logs /data && node deploy.mjs 2>&1 | tee -a /logs/deploy.log"]
