FROM node:22-alpine3.22

LABEL maintainer="Junmin Ahn"

WORKDIR /app

COPY --chown=node:node entrypoint.js /app/entrypoint.js

USER node

ENTRYPOINT ["node", "/app/entrypoint.js"]
