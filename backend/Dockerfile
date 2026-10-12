# VisionMate backend — cloud-д ажиллуулах image. Нууц түлхүүрийг (GEMINI_API_KEY, CHIMEGE_TOKEN)
# image-д биш, cloud-ийн environment тохиргоонд тавина. RAM 2 GB-аас багагүй байх нь зүйтэй.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# tsx нь devDependencies-д байдаг тул бүгдийг суулгана.
RUN npm ci

COPY . .
# Model-уудыг image-д оруулна — эс бөгөөс сервер дахин асах бүрд эхний хүсэлт минут гаруй хүлээнэ.
RUN npm run download-model && npx tsx scripts/warm-models.ts

ENV NODE_ENV=production
EXPOSE 8000
CMD ["npx", "tsx", "src/server.ts"]
