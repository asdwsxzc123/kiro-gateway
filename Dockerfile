# Kiro Gateway Dockerfile
# 多阶段构建：前端 + 后端

# ============ 前端构建阶段 ============
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/

# 安装依赖
RUN pnpm install

# 复制源代码
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

# 构建前端
WORKDIR /app/packages/frontend
RUN pnpm build

# ============ 后端构建阶段 ============
FROM node:20-alpine AS backend-builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

# 安装依赖
RUN pnpm install

# 复制源代码
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# 构建后端
WORKDIR /app/packages/backend
RUN pnpm build

# ============ 生产阶段 ============
FROM node:20-alpine AS production

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 设置环境变量
ENV NODE_ENV=production

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

# 只安装生产依赖
RUN pnpm install --prod

# 复制 shared 源码（运行时需要）
COPY packages/shared ./packages/shared

# 从构建阶段复制编译后的后端代码
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist

# 从构建阶段复制前端静态文件到后端 public 目录
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/backend/public

# 创建 data 目录
RUN mkdir -p /app/packages/backend/data

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 设置目录权限
RUN chown -R nodejs:nodejs /app/packages/backend/data

# 切换到非 root 用户
USER nodejs

WORKDIR /app/packages/backend

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# 启动命令
CMD ["node", "dist/index.js"]
