# Runs the whole site (frontend + API + SQLite database) as one container.
#   docker build -t biscotti .
#   docker run -p 3000:3000 -v biscotti-data:/data biscotti
# The -v volume is what keeps the database safe across restarts/redeploys.
FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend backend
COPY frontend frontend
VOLUME /data
EXPOSE 3000
CMD ["node", "backend/server.js"]
