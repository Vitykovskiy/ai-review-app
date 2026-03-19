# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine AS runtime

WORKDIR /app

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Codex CLI (uncomment if using codex)
# RUN npm install -g @openai/codex

# Copy only production deps and compiled output
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Run as non-root
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
