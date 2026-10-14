# Build context: this folder (woowtech/ai-content-report-cloudrun), on its own. contract.mjs here is
# a copy of the first receiver's contract; contract-sync.test.mjs keeps the two equal.
#   gcloud builds submit woowtech/ai-content-report-cloudrun --tag <image>
FROM node:22-alpine

ARG APP_UID=10001
ARG APP_GID=10001
RUN addgroup -g ${APP_GID} -S reportsvc \
  && adduser -u ${APP_UID} -S -D -H -G reportsvc reportsvc

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY contract.mjs server.mjs firestore-store.mjs store-port.mjs ./

ENV NODE_ENV=production
USER reportsvc:reportsvc
# Cloud Run sets PORT (8080).
EXPOSE 8080
CMD ["node", "server.mjs"]
