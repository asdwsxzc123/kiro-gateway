#!/bin/bash

# Kiro Gateway 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/你的用户名/kiro-gateway/main/install.sh | bash
# 或者: ./install.sh

set -e

# 配置
DOCKER_HUB_USERNAME="${DOCKER_HUB_USERNAME:-asdwsxzc123}"
IMAGE_NAME="kiro-gateway"
IMAGE_TAG="${IMAGE_TAG:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/kiro-gateway}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# 检查命令是否存在
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

# 检查 Docker
check_docker() {
    log_step "检查 Docker..."

    if ! check_command docker; then
        log_error "Docker 未安装，请先安装 Docker"
        log_info "安装指南: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker 未运行，请启动 Docker"
        exit 1
    fi

    log_info "Docker 已就绪"
}

# 检查 Docker Compose
check_docker_compose() {
    log_step "检查 Docker Compose..."

    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif check_command docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        log_error "Docker Compose 未安装"
        log_info "Docker Compose 通常随 Docker Desktop 一起安装"
        exit 1
    fi

    log_info "Docker Compose 已就绪"
}

# 创建安装目录
create_install_dir() {
    log_step "创建安装目录: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
}

# 生成 docker-compose.yml
generate_compose_file() {
    log_step "生成 docker-compose.yml..."

    if [ -z "$DOCKER_HUB_USERNAME" ]; then
        log_error "请设置 DOCKER_HUB_USERNAME 环境变量"
        log_info "用法: DOCKER_HUB_USERNAME=your-username ./install.sh"
        exit 1
    fi

    FULL_IMAGE="${DOCKER_HUB_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

    cat > docker-compose.yml << EOF
# Kiro Gateway Docker Compose 配置
# 自动生成，请勿手动修改

services:
  gateway:
    image: ${FULL_IMAGE}
    container_name: kiro-gateway
    restart: unless-stopped
    ports:
      - "\${PORT:-8000}:8000"
    environment:
      NODE_ENV: production
      PORT: "8000"
      HOST: 0.0.0.0
      REDIS_URL: redis://redis:6379
      REDIS_DB: "0"
      REDIS_KEY_PREFIX: "gateway:"
      ENCRYPTION_KEY: \${ENCRYPTION_KEY:-""}
      RATE_LIMIT_ENABLED: \${RATE_LIMIT_ENABLED:-false}
      RATE_LIMIT_WINDOW_MS: \${RATE_LIMIT_WINDOW_MS:-60000}
      RATE_LIMIT_MAX_REQUESTS: \${RATE_LIMIT_MAX_REQUESTS:-100}
      LOG_LEVEL: \${LOG_LEVEL:-info}
      JWT_SECRET: \${JWT_SECRET:-your-jwt-secret-change-in-production}
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - kiro-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  redis:
    image: redis:7-alpine
    container_name: kiro-redis
    restart: unless-stopped
    ports:
      - "\${REDIS_PORT:-16999}:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    networks:
      - kiro-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s

networks:
  kiro-network:
    driver: bridge

volumes:
  redis-data:
    driver: local
EOF

    log_info "docker-compose.yml 已生成"
}

# 生成 .env 文件
generate_env_file() {
    log_step "生成 .env 配置文件..."

    if [ -f .env ]; then
        log_warn ".env 文件已存在，跳过生成"
        return
    fi

    # 生成随机 JWT_SECRET
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 64)

    cat > .env << EOF
# Kiro Gateway 配置文件
# 请根据需要修改以下配置

# 服务端口
PORT=8000

# Redis 端口
REDIS_PORT=16999

# JWT 密钥 (生产环境请修改)
JWT_SECRET=${JWT_SECRET}

# 加密密钥 (可选)
ENCRYPTION_KEY=

# 限流配置
RATE_LIMIT_ENABLED=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# 日志级别 (debug, info, warn, error)
LOG_LEVEL=info
EOF

    log_info ".env 配置文件已生成"
}

# 生成管理脚本
generate_manage_script() {
    log_step "生成管理脚本..."

    cat > manage.sh << 'EOF'
#!/bin/bash

# Kiro Gateway 管理脚本

set -e

cd "$(dirname "$0")"

case "${1:-help}" in
    start)
        echo "启动服务..."
        docker compose up -d
        docker compose ps
        ;;
    stop)
        echo "停止服务..."
        docker compose down
        ;;
    restart)
        echo "重启服务..."
        docker compose restart
        docker compose ps
        ;;
    logs)
        docker compose logs -f --tail=100
        ;;
    status)
        docker compose ps
        ;;
    update)
        echo "更新镜像..."
        docker compose pull
        docker compose up -d
        docker compose ps
        ;;
    uninstall)
        echo "卸载服务..."
        docker compose down -v
        echo "服务已卸载，配置文件保留在当前目录"
        ;;
    *)
        echo "Kiro Gateway 管理脚本"
        echo ""
        echo "用法: ./manage.sh [命令]"
        echo ""
        echo "命令:"
        echo "  start     启动服务"
        echo "  stop      停止服务"
        echo "  restart   重启服务"
        echo "  logs      查看日志"
        echo "  status    查看状态"
        echo "  update    更新镜像"
        echo "  uninstall 卸载服务"
        ;;
esac
EOF

    chmod +x manage.sh
    log_info "管理脚本 manage.sh 已生成"
}

# 拉取镜像
pull_image() {
    log_step "拉取镜像..."
    $COMPOSE_CMD pull
    log_info "镜像拉取完成"
}

# 启动服务
start_services() {
    log_step "启动服务..."
    $COMPOSE_CMD up -d

    echo ""
    log_info "等待服务启动..."
    sleep 5

    $COMPOSE_CMD ps
}

# 显示完成信息
show_complete_info() {
    echo ""
    echo "========================================"
    echo -e "${GREEN}Kiro Gateway 安装完成!${NC}"
    echo "========================================"
    echo ""
    echo "安装目录: $INSTALL_DIR"
    echo "访问地址: http://localhost:8000"
    echo ""
    echo "管理命令:"
    echo "  cd $INSTALL_DIR"
    echo "  ./manage.sh start    # 启动"
    echo "  ./manage.sh stop     # 停止"
    echo "  ./manage.sh logs     # 日志"
    echo "  ./manage.sh update   # 更新"
    echo ""
    echo "配置文件: $INSTALL_DIR/.env"
    echo ""
}

# 检查是否已安装
check_installed() {
    if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/manage.sh" ]; then
        return 0
    fi
    return 1
}

# 升级服务
upgrade() {
    log_step "检测到已安装，执行升级..."
    cd "$INSTALL_DIR"

    log_step "拉取最新镜像..."
    $COMPOSE_CMD pull

    log_step "重启服务..."
    $COMPOSE_CMD up -d

    echo ""
    $COMPOSE_CMD ps

    echo ""
    echo "========================================"
    echo -e "${GREEN}Kiro Gateway 升级完成!${NC}"
    echo "========================================"
    echo ""
    echo "访问地址: http://localhost:8000"
    echo ""
}

# 主函数
main() {
    echo ""
    echo "========================================"
    echo "    Kiro Gateway 安装/升级脚本"
    echo "========================================"
    echo ""

    check_docker
    check_docker_compose

    # 检查是否已安装
    if check_installed; then
        upgrade
        exit 0
    fi

    # 首次安装
    create_install_dir
    generate_compose_file
    generate_env_file
    generate_manage_script
    pull_image
    start_services
    show_complete_info
}

# 运行
main "$@"
