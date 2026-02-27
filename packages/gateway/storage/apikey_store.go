package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// GetAllApiKeys returns all API key records.
func GetAllApiKeys(ctx context.Context) ([]model.ApiKeyRecord, error) {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(apiKeysKey)).Result()
	if err != nil {
		return nil, fmt.Errorf("get all api keys: %w", err)
	}

	records := make([]model.ApiKeyRecord, 0, len(data))
	for _, jsonStr := range data {
		var rec model.ApiKeyRecord
		if err := json.Unmarshal([]byte(jsonStr), &rec); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal API key record")
			continue
		}
		records = append(records, rec)
	}
	return records, nil
}

// GetApiKeyByID returns a single API key record by ID.
func GetApiKeyByID(ctx context.Context, id string) (*model.ApiKeyRecord, error) {
	rdb := GetClient()

	raw, err := rdb.HGet(ctx, Key(apiKeysKey), id).Result()
	if err != nil {
		if err.Error() == "redis: nil" {
			return nil, nil
		}
		return nil, fmt.Errorf("get api key %s: %w", id, err)
	}

	var rec model.ApiKeyRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return nil, fmt.Errorf("unmarshal api key %s: %w", id, err)
	}
	return &rec, nil
}

// ValidateApiKey looks up an API key by its value.
// Updates lastUsed on match. Falls back to full scan if index is stale.
func ValidateApiKey(ctx context.Context, key string) (*model.ApiKeyRecord, error) {
	rdb := GetClient()

	// Fast path: use key -> id index.
	recordID, err := rdb.HGet(ctx, Key(apiKeysIndexKey), key).Result()
	if err == nil && recordID != "" {
		raw, err := rdb.HGet(ctx, Key(apiKeysKey), recordID).Result()
		if err == nil && raw != "" {
			var rec model.ApiKeyRecord
			if err := json.Unmarshal([]byte(raw), &rec); err == nil && rec.Key == key {
				rec.LastUsed = nowMs()
				go func() {
					b, _ := json.Marshal(rec)
					rdb.HSet(context.Background(), Key(apiKeysKey), rec.ID, string(b))
				}()
				return &rec, nil
			}
		}
		// Index stale, remove it.
		rdb.HDel(ctx, Key(apiKeysIndexKey), key)
	}

	// Slow path: full scan and rebuild index.
	data, err := rdb.HGetAll(ctx, Key(apiKeysKey)).Result()
	if err != nil {
		return nil, fmt.Errorf("scan api keys: %w", err)
	}
	if len(data) == 0 {
		return nil, nil
	}

	pipe := rdb.Pipeline()
	var matched *model.ApiKeyRecord

	for _, jsonStr := range data {
		var rec model.ApiKeyRecord
		if err := json.Unmarshal([]byte(jsonStr), &rec); err != nil {
			continue
		}
		pipe.HSet(ctx, Key(apiKeysIndexKey), rec.Key, rec.ID)
		if rec.Key == key {
			rec.LastUsed = nowMs()
			b, _ := json.Marshal(rec)
			rdb.HSet(ctx, Key(apiKeysKey), rec.ID, string(b))
			matched = &rec
		}
	}
	pipe.Exec(ctx)

	return matched, nil
}

// AddApiKey persists a new API key and updates the key->id index.
func AddApiKey(ctx context.Context, record *model.ApiKeyRecord) error {
	rdb := GetClient()

	b, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal api key: %w", err)
	}

	pipe := rdb.Pipeline()
	pipe.HSet(ctx, Key(apiKeysKey), record.ID, string(b))
	pipe.HSet(ctx, Key(apiKeysIndexKey), record.Key, record.ID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("add api key: %w", err)
	}

	log.Info().Str("id", record.ID).Str("name", record.Name).Msg("API key added")
	return nil
}

// DeleteApiKey removes an API key and its index entry.
func DeleteApiKey(ctx context.Context, id string) error {
	rdb := GetClient()

	raw, err := rdb.HGet(ctx, Key(apiKeysKey), id).Result()
	if err != nil {
		return fmt.Errorf("delete api key %s: key not found", id)
	}

	var rec model.ApiKeyRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return fmt.Errorf("unmarshal api key for delete: %w", err)
	}

	pipe := rdb.Pipeline()
	pipe.HDel(ctx, Key(apiKeysKey), id)
	pipe.HDel(ctx, Key(apiKeysIndexKey), rec.Key)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("pipeline delete api key: %w", err)
	}

	log.Info().Str("id", id).Msg("API key deleted")
	return nil
}

// UpdateApiKey applies partial updates to an existing API key.
func UpdateApiKey(ctx context.Context, id string, updates map[string]interface{}) error {
	rdb := GetClient()

	raw, err := rdb.HGet(ctx, Key(apiKeysKey), id).Result()
	if err != nil {
		return fmt.Errorf("api key %s not found", id)
	}

	var rec model.ApiKeyRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return fmt.Errorf("unmarshal api key %s: %w", id, err)
	}

	if name, ok := updates["name"].(string); ok {
		rec.Name = name
	}
	if ids, ok := updates["boundAccountIds"].([]string); ok {
		rec.BoundAccountIDs = ids
	}
	if ql, ok := updates["quotaLimit"].(float64); ok {
		if ql > 0 {
			rec.QuotaLimit = ql
		} else {
			rec.QuotaLimit = 0
		}
	}

	b, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("marshal updated api key: %w", err)
	}

	if err := rdb.HSet(ctx, Key(apiKeysKey), id, string(b)).Err(); err != nil {
		return fmt.Errorf("save updated api key: %w", err)
	}

	log.Info().Str("id", id).Msg("API key updated")
	return nil
}

// RemoveAccountFromApiKeys removes an account ID from all API key bindings.
func RemoveAccountFromApiKeys(ctx context.Context, accountID string) error {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(apiKeysKey)).Result()
	if err != nil || len(data) == 0 {
		return nil
	}

	updated := 0
	for id, jsonStr := range data {
		var rec model.ApiKeyRecord
		if err := json.Unmarshal([]byte(jsonStr), &rec); err != nil {
			continue
		}
		if len(rec.BoundAccountIDs) == 0 {
			continue
		}

		filtered := make([]string, 0, len(rec.BoundAccountIDs))
		for _, aid := range rec.BoundAccountIDs {
			if aid != accountID {
				filtered = append(filtered, aid)
			}
		}
		if len(filtered) == len(rec.BoundAccountIDs) {
			continue
		}

		rec.BoundAccountIDs = filtered
		b, _ := json.Marshal(rec)
		rdb.HSet(ctx, Key(apiKeysKey), id, string(b))
		updated++
	}

	if updated > 0 {
		log.Info().Str("accountId", accountID).Int("updated", updated).Msg("Removed account from API key bindings")
	}
	return nil
}
