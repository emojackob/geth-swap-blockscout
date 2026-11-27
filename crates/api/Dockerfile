FROM node:22-bookworm-slim AS ui
WORKDIR /src
COPY console/package.json console/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY console/ ./
RUN npm run build

FROM rust:1.100-bookworm AS rust
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p lab-api

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=rust /src/target/release/lab-api /app/lab-api
COPY --from=ui /src/dist /app/console
COPY deploy/artifacts/pancake-v2.json /app/artifacts/pancake-v2.json
COPY chain/dev-accounts.json /app/dev-accounts.json
EXPOSE 8080
CMD ["sh", "-c", "mkdir -p /logs && /app/lab-api 2>&1 | tee -a /logs/api.log"]
