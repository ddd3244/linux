FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --production --no-audit --no-fund
COPY index.mjs ./

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

USER node
CMD ["node", "index.mjs"]
