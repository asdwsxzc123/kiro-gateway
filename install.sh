#!/bin/bash

# Kiro Gateway Installation Script
# Usage: ./install.sh

set -e

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

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

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
        lsb-release

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

        if check_command systemctl; then
            log_info "Attempting to start Docker service..."
            sudo systemctl start docker 2>/dev/null || true
        fi

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

# Generate .env file
generate_env_file() {
    log_step "Checking .env configuration..."

    if [ -f .env ]; then
        log_info ".env file exists, skipping"
        return
    fi

    log_info "Generating .env file..."
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 64)

    cat > .env << EOF
# Kiro Gateway Configuration

# Service port
PORT=8000

# Redis port
REDIS_PORT=16379

# JWT secret
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

    log_info ".env file generated"
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
    echo "Access URL: http://localhost:8000"
    echo ""
    echo "Commands:"
    echo "  docker compose up -d      # Start"
    echo "  docker compose down       # Stop"
    echo "  docker compose logs -f    # Logs"
    echo "  docker compose up -d --build  # Rebuild"
    echo ""
    echo "Configuration: .env"
    echo ""
}

# Main function
main() {
    echo ""
    echo "========================================"
    echo "    Kiro Gateway Installation Script"
    echo "========================================"
    echo ""

    # Check docker-compose.yml exists
    if [ ! -f "docker-compose.yml" ]; then
        log_error "docker-compose.yml not found in current directory"
        log_info "Please run this script from the project root directory"
        exit 1
    fi

    check_docker
    check_docker_compose
    generate_env_file
    build_and_start
    show_complete_info
}

# Run
main "$@"
