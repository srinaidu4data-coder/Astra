FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY content ./content
COPY scripts ./scripts
COPY tsconfig*.json vitest.config.ts ./
RUN npm install
RUN npm run generate:content
RUN npm run build:web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /app /app
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "@btp-odyssey/api"]
