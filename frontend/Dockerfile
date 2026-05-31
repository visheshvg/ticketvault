FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM base AS dev
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS builder
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=builder /app/dist /usr/share/nginx/html
COPY infrastructure/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
