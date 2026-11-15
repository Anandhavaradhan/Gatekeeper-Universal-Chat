# Gatekeeper Universal Chat: the web app and its server in one container.
# Works on Google Cloud Run, Render, Fly.io, Railway or any host that runs containers.
#
#   docker build -t gatekeeper .
#   docker run -p 3000:3000 -e GEMINI_API_KEY=... -e GOOGLE_APPLICATION_CREDENTIALS=/key.json -v ./key.json:/key.json gatekeeper
#
# On Cloud Run the service account gives the server its Firebase access, so only GEMINI_API_KEY is needed.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY firebase-applet-config.json ./
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
