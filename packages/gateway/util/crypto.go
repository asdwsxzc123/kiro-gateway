package util

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	ivLength        = 16
	encryptedPrefix = "ENC:"
)

// DeriveKey produces a 32-byte AES-256 key by taking the SHA-256 hash of the
// provided key string. This matches the TypeScript backend behaviour.
func DeriveKey(key string) []byte {
	h := sha256.Sum256([]byte(key))
	return h[:]
}

// Encrypt encrypts plaintext using AES-256-GCM and returns a string in the
// format "ENC:{base64_iv}:{base64_authTag}:{base64_encrypted}".
// If key is empty, the plaintext is returned unchanged.
func Encrypt(plaintext string, key string) (string, error) {
	if key == "" {
		return plaintext, nil
	}

	derivedKey := DeriveKey(key)

	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return "", fmt.Errorf("crypto: failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCMWithNonceSize(block, ivLength)
	if err != nil {
		return "", fmt.Errorf("crypto: failed to create GCM: %w", err)
	}

	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("crypto: failed to generate IV: %w", err)
	}

	// Seal appends the ciphertext and authentication tag.
	sealed := aesGCM.Seal(nil, iv, []byte(plaintext), nil)

	// The auth tag is the last aesGCM.Overhead() bytes of sealed.
	tagSize := aesGCM.Overhead()
	encrypted := sealed[:len(sealed)-tagSize]
	authTag := sealed[len(sealed)-tagSize:]

	ivB64 := base64.StdEncoding.EncodeToString(iv)
	tagB64 := base64.StdEncoding.EncodeToString(authTag)
	encB64 := base64.StdEncoding.EncodeToString(encrypted)

	return fmt.Sprintf("%s%s:%s:%s", encryptedPrefix, ivB64, tagB64, encB64), nil
}

// Decrypt decrypts a string produced by Encrypt. If the key is empty or the
// text is not in encrypted format, the original text is returned unchanged.
func Decrypt(ciphertext string, key string) (string, error) {
	if key == "" {
		return ciphertext, nil
	}

	if !strings.HasPrefix(ciphertext, encryptedPrefix) {
		// Not encrypted, return as-is.
		return ciphertext, nil
	}

	encryptedPart := ciphertext[len(encryptedPrefix):]
	parts := strings.SplitN(encryptedPart, ":", 3)
	if len(parts) != 3 {
		// Malformed, return original.
		return ciphertext, nil
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: invalid IV base64: %w", err)
	}

	authTag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: invalid auth tag base64: %w", err)
	}

	encrypted, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: invalid ciphertext base64: %w", err)
	}

	derivedKey := DeriveKey(key)

	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCMWithNonceSize(block, ivLength)
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: failed to create GCM: %w", err)
	}

	// Re-assemble: ciphertext + authTag (as Go's GCM expects).
	combined := append(encrypted, authTag...)

	plaintext, err := aesGCM.Open(nil, iv, combined, nil)
	if err != nil {
		return ciphertext, fmt.Errorf("crypto: decryption failed: %w", err)
	}

	return string(plaintext), nil
}

// IsEncrypted returns true if the text appears to be in the encrypted format
// produced by Encrypt ("ENC:{base64}:{base64}:{base64}").
func IsEncrypted(text string) bool {
	if !strings.HasPrefix(text, encryptedPrefix) {
		return false
	}

	encryptedPart := text[len(encryptedPrefix):]
	parts := strings.SplitN(encryptedPart, ":", 3)
	if len(parts) != 3 {
		return false
	}

	// Validate that the first two parts are valid base64.
	if _, err := base64.StdEncoding.DecodeString(parts[0]); err != nil {
		return false
	}
	if _, err := base64.StdEncoding.DecodeString(parts[1]); err != nil {
		return false
	}

	return true
}
