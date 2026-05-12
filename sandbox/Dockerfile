FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /app
COPY server.js /app/server.js

EXPOSE 3100

USER nobody

CMD ["node", "/app/server.js"]
