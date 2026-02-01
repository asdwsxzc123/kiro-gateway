#!/bin/bash

# Kiro Gateway Installation Script
# Usage: curl -fsSL https://gitee.com/asdwsxzc123/kiro-gateway/raw/master/install.sh | bash
# Or: ./install.sh

set -e

# Configuration
GIT_REPO="${GIT_REPO:-https://gitee.com/asdwsxzc123/kiro-gateway.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/kiro-gateway}"

# Colors
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

# Check if command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

# Detect operating system
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

# Install Docker (Ubuntu/Debian)
install_docker_debian() {
    log_step "Installing Docker..."

    # Check for sudo privileges
    if [ "$EUID" -ne 0 ]; then
        if ! check_command sudo; then
            log_error "Root privileges required to install Docker. Please run with sudo."
            exit 1
        fi
        SUDO="sudo"
    else
        SUDO=""
    fi

    log_info "Updating package index..."
    $SUDO apt-get update -y

    log_info "Installing dependencies..."
    $SUDO apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        git

    log_info "Adding Docker GPG key..."
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

    log_info "Setting up Docker repository..."
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

    log_info "Installing Docker Engine..."
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    log_info "Starting Docker service..."
    $SUDO systemctl start docker
    $SUDO systemctl enable docker

    # Add current user to docker group
    if [ "$EUID" -ne 0 ]; then
        log_info "Adding current user to docker group..."
        $SUDO usermod -aG docker $USER
        log_warn "User group updated. You may need to logout or run 'newgrp docker' for changes to take effect."
    fi

    log_info "Docker installation completed!"
}

# Check Docker
check_docker() {
    log_step "Checking Docker..."

    if ! check_command docker; then
        log_warn "Docker not installed"

        detect_os

        case "$OS" in
            ubuntu|debian)
                log_info "Detected $OS system, installing Docker automatically..."
                install_docker_debian
                ;;
            *)
                log_error "Auto-install not supported for: $OS"
                log_info "Please install Docker manually: https://docs.docker.com/get-docker/"
                exit 1
                ;;
        esac
    fi

    if ! docker info &> /dev/null; then
        log_warn "Docker not running or permission denied"

        # Try to start Docker
        if check_command systemctl; then
            log_info "Attempting to start Docker service..."
            sudo systemctl start docker 2>/dev/null || true
        fi

        # Check again
        if ! docker info &> /dev/null; then
            log_error "Docker not running. Please try:"
            log_info "  1. Run 'sudo systemctl start docker' to start Docker"
            log_info "  2. Run 'newgrp docker' to refresh user group"
            log_info "  3. Or logout and login again"
            exit 1
        fi
    fi

    log_info "Docker is ready"
}

# Check Docker Compose
check_docker_compose() {
    log_step "Checking Docker Compose..."

    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif check_command docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        log_error "Docker Compose not installed"
        log_info "Docker Compose is usually installed with Docker Desktop"
        exit 1
    fi

    log_info "Docker Compose is ready"
}

# Check Git
check_git() {
    log_step "Checking Git..."

    if ! check_command git; then
        log_warn "Git not installed, installing..."

        detect_os

        case "$OS" in
            ubuntu|debian)
                sudo apt-get update -y && sudo apt-get install -y git
                ;;
            centos|rhel|fedora)
                sudo yum install -y git || sudo dnf install -y git
                ;;
            *)
                log_error "Please install Git manually"
                exit 1
                ;;
        esac
    fi

    log_info "Git is ready"
}

# Clone or update repository
clone_or_update_repo() {
    log_step "Setting up source code..."

    if [ -d "$INSTALL_DIR/.git" ]; then
        log_info "Repository exists, pulling latest changes..."
        cd "$INSTALL_DIR"
        git pull origin master || git pull origin main || true
    else
        log_info "Cloning repository..."
        rm -rf "$INSTALL_DIR"
        git clone "$GIT_REPO" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    log_info "Source code ready"
}

# Generate .env file
generate_env_file() {
    log_step "Generating .env configuration file..."

    if [ -f .env ]; then
        log_warn ".env file already exists, skipping"
        return
    fi

    # Generate random JWT_SECRET
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 64)

    cat > .env << EOF
# Kiro Gateway Configuration
# Modify as needed

# Service port
PORT=8000

# Redis port
REDIS_PORT=16379

# JWT secret (change in production)
JWT_SECRET=${JWT_SECRET}

# Encryption key (optional)
ENCRYPTION_KEY=

# Rate limiting
RATE_LIMIT_ENABLED=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Log level (debug, info, warn, error)
LOG_LEVEL=info
EOF

    log_info ".env configuration file generated"
}

# Generate management script
generate_manage_script() {
    log_step "Generating management script..."

    cat > manage.sh << 'EOF'
#!/bin/bash

# Kiro Gateway Management Script

set -e

cd "$(dirname "$0")"

case "${1:-help}" in
    start)
        echo "Starting services..."
        docker compose up -d
        docker compose ps
        ;;
    stop)
        echo "Stopping services..."
        docker compose down
        ;;
    restart)
        echo "Restarting services..."
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
        echo "Updating..."
        git pull origin master || git pull origin main || true
        docker compose down
        docker compose up -d --build
        docker compose ps
        ;;
    rebuild)
        echo "Rebuilding..."
        docker compose down
        docker compose build --no-cache
        docker compose up -d
        docker compose ps
        ;;
    uninstall)
        echo "Uninstalling services..."
        docker compose down -v
        echo "Services uninstalled. Configuration files remain in current directory."
        ;;
    *)
        echo "Kiro Gateway Management Script"
        echo ""
        echo "Usage: ./manage.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start     Start services"
        echo "  stop      Stop services"
        echo "  restart   Restart services"
        echo "  logs      View logs"
        echo "  status    View status"
        echo "  update    Update and rebuild"
        echo "  rebuild   Force rebuild"
        echo "  uninstall Uninstall services"
        ;;
esac
EOF

    chmod +x manage.sh
    log_info "Management script manage.sh generated"
}

# Build and start services
build_and_start() {
    log_step "Building and starting services..."
    log_info "This may take a few minutes on first run..."

    $COMPOSE_CMD up -d --build

    echo ""
    log_info "Waiting for services to start..."
    sleep 5

    $COMPOSE_CMD ps
}

# Show completion info
show_complete_info() {
    echo ""
    echo "========================================"
    echo -e "${GREEN}Kiro Gateway Installation Complete!${NC}"
    echo "========================================"
    echo ""
    echo "Install directory: $INSTALL_DIR"
    echo "Access URL: http://localhost:8000"
    echo ""
    echo "Management commands:"
    echo "  cd $INSTALL_DIR"
    echo "  ./manage.sh start    # Start"
    echo "  ./manage.sh stop     # Stop"
    echo "  ./manage.sh logs     # Logs"
    echo "  ./manage.sh update   # Update"
    echo ""
    echo "Configuration file: $INSTALL_DIR/.env"
    echo ""
}

# Check if already installed
check_installed() {
    if [ -d "$INSTALL_DIR/.git" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
        return 0
    fi
    return 1
}

# Upgrade services
upgrade() {
    log_step "Installation detected, upgrading..."
    cd "$INSTALL_DIR"

    log_step "Pulling latest code..."
    git pull origin master || git pull origin main || true

    log_step "Rebuilding and restarting services..."
    $COMPOSE_CMD down
    $COMPOSE_CMD up -d --build

    echo ""
    $COMPOSE_CMD ps

    echo ""
    echo "========================================"
    echo -e "${GREEN}Kiro Gateway Upgrade Complete!${NC}"
    echo "========================================"
    echo ""
    echo "Access URL: http://localhost:8000"
    echo ""
}

# Main function
main() {
    echo ""
    echo "========================================"
    echo "    Kiro Gateway Install/Upgrade Script"
    echo "========================================"
    echo ""

    check_docker
    check_docker_compose
    check_git

    # Check if already installed
    if check_installed; then
        upgrade
        exit 0
    fi

    # Fresh install
    clone_or_update_repo
    generate_env_file
    generate_manage_script
    build_and_start
    show_complete_info
}

# Run
main "$@"
