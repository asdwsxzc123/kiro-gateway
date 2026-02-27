package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

// AdminUser represents the persisted admin account.
type AdminUser struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

var (
	adminMu   sync.RWMutex
	adminFile string
)

func init() {
	adminFile = filepath.Join("data", "admin.json")
}

// SetAdminFilePath allows overriding the admin file path (e.g. for testing).
func SetAdminFilePath(path string) {
	adminMu.Lock()
	defer adminMu.Unlock()
	adminFile = path
}

// ensureDataDir creates the data directory if it does not exist.
func ensureDataDir() error {
	dir := filepath.Dir(adminFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	return nil
}

// readAdminData reads the admin user from the JSON file.
func readAdminData() (*AdminUser, error) {
	adminMu.RLock()
	defer adminMu.RUnlock()

	data, err := os.ReadFile(adminFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read admin file: %w", err)
	}

	var admin AdminUser
	if err := json.Unmarshal(data, &admin); err != nil {
		return nil, fmt.Errorf("unmarshal admin data: %w", err)
	}
	return &admin, nil
}

// writeAdminData writes the admin user to the JSON file.
func writeAdminData(admin *AdminUser) error {
	adminMu.Lock()
	defer adminMu.Unlock()

	if err := ensureDataDir(); err != nil {
		return err
	}

	data, err := json.MarshalIndent(admin, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal admin data: %w", err)
	}

	if err := os.WriteFile(adminFile, data, 0644); err != nil {
		return fmt.Errorf("write admin file: %w", err)
	}

	log.Info().Msg("Admin data saved")
	return nil
}

// InitAdmin creates the admin account from the given credentials if it does
// not already exist. This matches the TypeScript backend behavior.
func InitAdmin(username, password string) error {
	existing, err := readAdminData()
	if err != nil {
		return err
	}
	if existing != nil {
		log.Info().Str("username", existing.Username).Msg("Admin account already exists")
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	now := time.Now().UnixMilli()
	admin := &AdminUser{
		Username:     username,
		PasswordHash: string(hash),
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := writeAdminData(admin); err != nil {
		return err
	}

	log.Info().Str("username", username).Msg("Admin account initialized")
	return nil
}

// ValidatePassword checks the provided credentials against the stored admin.
func ValidatePassword(username, password string) (bool, error) {
	admin, err := readAdminData()
	if err != nil {
		return false, err
	}
	if admin == nil {
		log.Warn().Msg("Admin account not found")
		return false, nil
	}
	if admin.Username != username {
		log.Warn().Str("provided", username).Msg("Invalid username")
		return false, nil
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)); err != nil {
		log.Warn().Str("username", username).Msg("Invalid password")
		return false, nil
	}
	return true, nil
}

// UpdatePassword changes the admin password after verifying the old one.
func UpdatePassword(oldPassword, newPassword string) error {
	admin, err := readAdminData()
	if err != nil {
		return err
	}
	if admin == nil {
		return fmt.Errorf("admin account not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(oldPassword)); err != nil {
		return fmt.Errorf("old password verification failed")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}

	admin.PasswordHash = string(hash)
	admin.UpdatedAt = time.Now().UnixMilli()

	if err := writeAdminData(admin); err != nil {
		return err
	}

	log.Info().Msg("Admin password updated")
	return nil
}

// GetAdmin returns the current admin user, or nil if none exists.
func GetAdmin() (*AdminUser, error) {
	return readAdminData()
}
