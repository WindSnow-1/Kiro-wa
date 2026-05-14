FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY src ./src
COPY admin-ui ./admin-ui

VOLUME ["/app/config"]
EXPOSE 8990

CMD ["node", "src/index.js", "-c", "/app/config/config.json", "--credentials", "/app/config/credentials.json"]
