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

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    else
        OS="unknown"
        OS_VERSION="unknown"
    fi
}

# 安装 Docker (Ubuntu/Debian)
install_docker_debian() {
    log_step "开始安装 Docker..."

    # 检查是否有 sudo 权限
    if [ "$EUID" -ne 0 ]; then
        if ! check_command sudo; then
            log_error "需要 root 权限安装 Docker，请使用 sudo 运行此脚本"
            exit 1
        fi
        SUDO="sudo"
    else
        SUDO=""
    fi

    log_info "更新软件包索引..."
    $SUDO apt-get update -y

    log_info "安装依赖包..."
    $SUDO apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    log_info "添加 Docker 官方 GPG 密钥..."
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

    log_info "设置 Docker 仓库..."
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

    log_info "安装 Docker Engine..."
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    log_info "启动 Docker 服务..."
    $SUDO systemctl start docker
    $SUDO systemctl enable docker

    # 将当前用户添加到 docker 组
    if [ "$EUID" -ne 0 ]; then
        log_info "将当前用户添加到 docker 组..."
        $SUDO usermod -aG docker $USER
        log_warn "用户组已更新，可能需要重新登录或运行 'newgrp docker' 使更改生效"
    fi

    log_info "Docker 安装完成!"
}

# 检查 Docker
check_docker() {
    log_step "检查 Docker..."

    if ! check_command docker; then
        log_warn "Docker 未安装"

        detect_os

        case "$OS" in
            ubuntu|debian)
                log_info "检测到 $OS 系统，开始自动安装 Docker..."
                install_docker_debian
                ;;
            *)
                log_error "不支持自动安装 Docker 的系统: $OS"
                log_info "请手动安装 Docker: https://docs.docker.com/get-docker/"
                exit 1
                ;;
        esac
    fi

    if ! docker info &> /dev/null; then
        log_warn "Docker 未运行或当前用户无权限"

        # 尝试启动 Docker
        if check_command systemctl; then
            log_info "尝试启动 Docker 服务..."
            sudo systemctl start docker 2>/dev/null || true
        fi

        # 再次检查
        if ! docker info &> /dev/null; then
            log_error "Docker 未运行，请尝试以下操作："
            log_info "  1. 运行 'sudo systemctl start docker' 启动 Docker"
            log_info "  2. 运行 'newgrp docker' 刷新用户组"
            log_info "  3. 或重新登录系统"
            exit 1
        fi
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
