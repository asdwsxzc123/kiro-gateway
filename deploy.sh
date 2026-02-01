#!/bin/bash

# Kiro Gateway 部署脚本
# 用法: ./deploy.sh [命令]
# 命令:
#   deploy    - 构建并部署 (默认)
#   rebuild   - 强制重新构建并部署
#   stop      - 停止服务
#   restart   - 重启服务
#   logs      - 查看日志
#   push      - 构建并推送到 Docker Hub

set -e

# 配置
DOCKER_HUB_USERNAME="${DOCKER_HUB_USERNAME:-}"
IMAGE_NAME="kiro-gateway"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 切换到项目根目录
cd "$(dirname "$0")"

# 部署函数
deploy() {
    log_info "开始部署 Kiro Gateway..."
    docker compose up -d --build
    log_info "部署完成!"
    docker compose ps
}

# 强制重新构建
rebuild() {
    log_info "强制重新构建..."
    docker compose down
    docker compose build --no-cache
    docker compose up -d
    log_info "重新构建完成!"
    docker compose ps
}

# 停止服务
stop() {
    log_info "停止服务..."
    docker compose down
    log_info "服务已停止"
}

# 重启服务
restart() {
    log_info "重启服务..."
    docker compose restart
    log_info "服务已重启"
    docker compose ps
}

# 查看日志
logs() {
    docker compose logs -f --tail=100
}

# Push to Docker Hub (multi-platform)
push() {
    if [ -z "$DOCKER_HUB_USERNAME" ]; then
        log_error "Please set DOCKER_HUB_USERNAME environment variable"
        log_info "Usage: DOCKER_HUB_USERNAME=your-username ./deploy.sh push"
        exit 1
    fi

    FULL_IMAGE_NAME="${DOCKER_HUB_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

    log_info "Setting up buildx for multi-platform build..."

    # Create buildx builder if not exists
    if ! docker buildx inspect multiplatform-builder &> /dev/null; then
        docker buildx create --name multiplatform-builder --use
    else
        docker buildx use multiplatform-builder
    fi

    log_info "Building multi-platform image: ${FULL_IMAGE_NAME}"
    log_info "Platforms: linux/amd64, linux/arm64"

    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t "${FULL_IMAGE_NAME}" \
        --push \
        .

    log_info "Image pushed: ${FULL_IMAGE_NAME}"
    echo ""
    echo "Users can pull with:"
    echo "  docker pull ${FULL_IMAGE_NAME}"
}

# 显示帮助
help() {
    echo "Kiro Gateway 部署脚本"
    echo ""
    echo "用法: ./deploy.sh [命令]"
    echo ""
    echo "命令:"
    echo "  deploy    构建并部署 (默认)"
    echo "  rebuild   强制重新构建并部署 (清除缓存)"
    echo "  stop      停止所有服务"
    echo "  restart   重启服务"
    echo "  logs      查看服务日志"
    echo "  push      构建并推送镜像到 Docker Hub"
    echo "  help      显示此帮助信息"
    echo ""
    echo "环境变量:"
    echo "  DOCKER_HUB_USERNAME  Docker Hub 用户名 (push 命令需要)"
    echo "  IMAGE_TAG            镜像标签 (默认: latest)"
}

# 主逻辑
case "${1:-deploy}" in
    deploy)
        deploy
        ;;
    rebuild)
        rebuild
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    logs)
        logs
        ;;
    push)
        push
        ;;
    help|--help|-h)
        help
        ;;
    *)
        log_error "未知命令: $1"
        help
        exit 1
        ;;
esac
