FROM node:22-alpine

ARG APP_UID=10001
ARG APP_GID=10001
RUN addgroup -g ${APP_GID} -S reportsvc \
  && adduser -u ${APP_UID} -S -D -H -G reportsvc reportsvc \
  && mkdir -p /app /var/lib/woowtech-ai-reports \
  && chown -R reportsvc:reportsvc /app /var/lib/woowtech-ai-reports \
  && chmod 0700 /var/lib/woowtech-ai-reports

WORKDIR /app
COPY --chown=reportsvc:reportsvc woowtech/ai-content-report-service/service.mjs woowtech/ai-content-report-service/contract.mjs woowtech/ai-content-report-service/queue-admin.mjs ./

ENV NODE_ENV=production \
  AI_REPORT_HOST=0.0.0.0 \
  AI_REPORT_PORT=8787 \
  AI_REPORT_ALLOW_NON_LOOPBACK=1 \
  AI_REPORT_QUEUE_DIR=/var/lib/woowtech-ai-reports \
  AI_REPORT_RETENTION_DAYS=30 \
  AI_REPORT_MAX_QUEUE_RECORDS=10000 \
  AI_REPORT_MAX_QUEUE_BYTES=104857600

USER reportsvc:reportsvc
VOLUME ["/var/lib/woowtech-ai-reports"]
EXPOSE 8787
CMD ["node", "service.mjs"]
