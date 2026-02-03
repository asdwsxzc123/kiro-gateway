
# 部署到 docker hub
DOCKER_HUB_USERNAME=asdwsxzc123 IMAGE_TAG=v1.0.0 ./deploy.sh push

## 安装脚本
 curl -fsSL https://gitee.com/asdwsxzc123/kiro-gateway/raw/master/install.sh | bash


 ## 如何推送 pub

  # 1. 登录 Docker Hub
  docker login

  # 2. 构建镜像（带标签）
  docker build -t asdwsxzc123/kiro-gateway:latest .

  # 3. 推送到 Docker Hub
  docker push asdwsxzc123/kiro-gateway:latest

  如果要推送带版本号的镜像：

  docker build -t asdwsxzc123/kiro-gateway:1.1.0 .
  docker push asdwsxzc123/kiro-gateway:1.1.0