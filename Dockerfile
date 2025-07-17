# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# 1️⃣ Copy only package manifests first
COPY package*.json ./

# 2️⃣ Install production deps
RUN npm ci --production

# 3️⃣ Copy the rest of the source code
COPY . .

# ---------- runtime stage ----------
FROM node:20-alpine
WORKDIR /app

# 4️⃣ Bring in just the built app from the builder
COPY --from=build /app /app

# 5️⃣ Drop privileges (optional)
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "server.js"]
