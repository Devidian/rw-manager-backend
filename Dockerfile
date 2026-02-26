FROM node:24-slim AS builder

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN corepack enable
RUN yarn install --immutable

COPY tsconfig.json .
COPY src ./src

RUN yarn build

# --- Runtime Image ---
FROM node:24-slim

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN corepack enable
RUN yarn workspaces focus --production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]