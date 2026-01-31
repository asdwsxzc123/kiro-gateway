import { apiClient } from "./client"

interface LoginResponse {
  success: boolean
  data: {
    token: string
    expiresIn: string
    user: { username: string }
  }
}

interface MeResponse {
  success: boolean
  data: {
    user: { username: string }
  }
}

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<LoginResponse>("/auth/login", { username, password }),
  logout: () => apiClient.post("/auth/logout"),
  me: () => apiClient.get<MeResponse>("/auth/me"),
  updatePassword: (oldPassword: string, newPassword: string) =>
    apiClient.put("/auth/password", { oldPassword, newPassword }),
}
