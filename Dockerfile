FROM node:22-alpine3.22

LABEL maintainer="Junmin Ahn"

WORKDIR /app

COPY --chown=node:node entrypoint.js source.js /app/

USER node

ENTRYPOINT ["node", "/app/entrypoint.js"]
