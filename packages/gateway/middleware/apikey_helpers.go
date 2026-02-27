package middleware

import (
	"context"

	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

// lookupAPIKey validates an API key string against Redis storage.
func lookupAPIKey(ctx context.Context, key string) (*model.ApiKeyRecord, error) {
	return storage.ValidateApiKey(ctx, key)
}

// getAPIKeyTotalCost retrieves the total accumulated cost for an API key.
func getAPIKeyTotalCost(ctx context.Context, keyID string) (float64, error) {
	stats, err := storage.GetApiKeyTotalStats(ctx, keyID)
	if err != nil {
		return 0, err
	}
	return stats.TotalCost, nil
}
