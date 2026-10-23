FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--no-warnings", "server/index.js"]
