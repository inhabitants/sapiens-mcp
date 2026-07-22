# Dockerfile — Sapiens MCP (github.com/inhabitants/sapiens-mcp)
# Para o check do Glama: compila o TypeScript e arranca o server em stdio.
# Verificado no src/index.ts: tools/list responde SEM autenticação → a
# introspection passa mesmo sem sessão. Uso npm install (não npm ci) para
# tolerar package-lock.json fora de sync após bumps de versão.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY README.md ./
# Transporte stdio — o Glama fala MCP pelo stdin/stdout do processo.
CMD ["node", "dist/index.js"]
