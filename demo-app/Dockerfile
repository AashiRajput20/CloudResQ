FROM node:latest

WORKDIR /app

# Copy package files first so Docker caches the npm install layer
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3000
EXPOSE 3000

# Run as the non-root user that ships with the node image
USER node

CMD ["node", "src/server.js"]