FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV CAPO_DATA_DIR=/data
COPY --chown=node:node server.mjs ./server.mjs
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
