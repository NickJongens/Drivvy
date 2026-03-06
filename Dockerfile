FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY index.html ./
COPY styles.css ./
COPY src ./src
COPY data ./data

ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
