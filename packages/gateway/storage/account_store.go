package storage

import (
	"context"
	"fmt"
	"strconv"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// Redis key constants for account storage.
// These produce keys like "gateway:account:{id}", matching the TS backend.
const (
	accountKeyPrefix    = "account:"
	accountsIndexKey    = "accounts:index"
	accountsAvailKey    = "accounts:available"
	machineIDsKey       = "machineIds"
)

// serializeAccount converts a ProxyAccount to a flat string map for Redis HASH.
func serializeAccount(account *model.ProxyAccount) map[string]interface{} {
	data := make(map[string]interface{})

	set := func(k, v string) {
		if v != "" {
			data[k] = v
		}
	}
	setInt := func(k string, v int64) {
		if v != 0 {
			data[k] = strconv.FormatInt(v, 10)
		}
	}

	set("id", account.ID)
	set("alias", account.Alias)
	set("email", account.Email)
	set("userId", account.UserID)
	set("accessToken", account.AccessToken)
	set("refreshToken", account.RefreshToken)
	set("clientId", account.ClientID)
	set("clientSecret", account.ClientSecret)
	set("region", account.Region)
	set("authMethod", account.AuthMethod)
	set("provider", account.Provider)
	set("profileArn", account.ProfileArn)
	set("machineId", account.MachineID)
	set("proxyUrl", account.ProxyURL)
	set("status", string(account.Status))
	set("statusReason", account.StatusReason)

	setInt("expiresAt", account.ExpiresAt)
	setInt("machineIdCreatedAt", account.MachineIDCreatedAt)
	setInt("maxConcurrency", int64(account.MaxConcurrency))
	setInt("lastUsed", account.LastUsed)
	setInt("requestCount", account.RequestCount)
	setInt("errorCount", account.ErrorCount)
	setInt("cooldownUntil", account.CooldownUntil)
	setInt("createdAt", account.CreatedAt)
	setInt("statusChangedAt", account.StatusChangedAt)

	return data
}

// deserializeAccount converts a Redis HASH string map back to a ProxyAccount.
func deserializeAccount(data map[string]string) model.ProxyAccount {
	var acct model.ProxyAccount

	acct.ID = data["id"]
	acct.Alias = data["alias"]
	acct.Email = data["email"]
	acct.UserID = data["userId"]
	acct.AccessToken = data["accessToken"]
	acct.RefreshToken = data["refreshToken"]
	acct.ClientID = data["clientId"]
	acct.ClientSecret = data["clientSecret"]
	acct.Region = data["region"]
	acct.AuthMethod = data["authMethod"]
	acct.Provider = data["provider"]
	acct.ProfileArn = data["profileArn"]
	acct.MachineID = data["machineId"]
	acct.ProxyURL = data["proxyUrl"]
	acct.StatusReason = data["statusReason"]

	acct.ExpiresAt = parseInt64(data["expiresAt"])
	acct.MachineIDCreatedAt = parseInt64(data["machineIdCreatedAt"])
	acct.MaxConcurrency = int(parseInt64(data["maxConcurrency"]))
	acct.LastUsed = parseInt64(data["lastUsed"])
	acct.RequestCount = parseInt64(data["requestCount"])
	acct.ErrorCount = parseInt64(data["errorCount"])
	acct.CooldownUntil = parseInt64(data["cooldownUntil"])
	acct.CreatedAt = parseInt64(data["createdAt"])
	acct.StatusChangedAt = parseInt64(data["statusChangedAt"])

	// Backward compatibility: migrate isAvailable -> status.
	if isAvail, ok := data["isAvailable"]; ok && data["status"] == "" {
		if isAvail == "true" {
			acct.Status = model.AccountStatusActive
		} else {
			acct.Status = model.AccountStatusErrorSuspended
		}
	} else {
		acct.Status = model.AccountStatus(data["status"])
	}

	// Default status if empty.
	if acct.Status == "" {
		acct.Status = model.AccountStatusActive
	}

	return acct
}

// GetAllAccounts returns all accounts ordered by createdAt.
func GetAllAccounts(ctx context.Context) ([]model.ProxyAccount, error) {
	rdb := GetClient()

	ids, err := rdb.ZRange(ctx, Key(accountsIndexKey), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("get account index: %w", err)
	}
	if len(ids) == 0 {
		return []model.ProxyAccount{}, nil
	}

	pipe := rdb.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, len(ids))
	for i, id := range ids {
		cmds[i] = pipe.HGetAll(ctx, Key(accountKeyPrefix+id))
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		return nil, fmt.Errorf("pipeline get accounts: %w", err)
	}

	accounts := make([]model.ProxyAccount, 0, len(ids))
	for _, cmd := range cmds {
		data, err := cmd.Result()
		if err != nil || len(data) == 0 {
			continue
		}
		accounts = append(accounts, deserializeAccount(data))
	}
	return accounts, nil
}

// GetAccountByID returns a single account by ID, or nil if not found.
func GetAccountByID(ctx context.Context, id string) (*model.ProxyAccount, error) {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(accountKeyPrefix+id)).Result()
	if err != nil {
		return nil, fmt.Errorf("get account %s: %w", id, err)
	}
	if len(data) == 0 {
		return nil, nil
	}

	acct := deserializeAccount(data)
	return &acct, nil
}

// AddAccount persists a new account to Redis, updating all indexes.
func AddAccount(ctx context.Context, account *model.ProxyAccount) error {
	rdb := GetClient()
	serialized := serializeAccount(account)

	pipe := rdb.Pipeline()
	pipe.HSet(ctx, Key(accountKeyPrefix+account.ID), serialized)
	pipe.ZAdd(ctx, Key(accountsIndexKey), redis.Z{
		Score:  float64(account.CreatedAt),
		Member: account.ID,
	})
	pipe.SAdd(ctx, Key(accountsAvailKey), account.ID)
	pipe.SAdd(ctx, Key(machineIDsKey), account.MachineID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("add account %s: %w", account.ID, err)
	}

	log.Info().Str("id", account.ID).Str("email", account.Email).Msg("Account added")
	return nil
}

// UpdateAccount applies partial updates to an existing account.
func UpdateAccount(ctx context.Context, id string, updates map[string]interface{}) error {
	rdb := GetClient()

	existing, err := GetAccountByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return fmt.Errorf("account %s not found", id)
	}

	// Handle machineId index updates.
	if newMID, ok := updates["machineId"]; ok {
		if newMIDStr, ok := newMID.(string); ok && newMIDStr != existing.MachineID {
			rdb.SRem(ctx, Key(machineIDsKey), existing.MachineID)
			rdb.SAdd(ctx, Key(machineIDsKey), newMIDStr)
		}
	}

	// Convert all values to strings for HSET.
	fields := make(map[string]interface{}, len(updates))
	for k, v := range updates {
		switch val := v.(type) {
		case string:
			fields[k] = val
		case int:
			fields[k] = strconv.Itoa(val)
		case int64:
			fields[k] = strconv.FormatInt(val, 10)
		case float64:
			fields[k] = strconv.FormatFloat(val, 'f', -1, 64)
		case bool:
			if val {
				fields[k] = "true"
			} else {
				fields[k] = "false"
			}
		default:
			fields[k] = fmt.Sprintf("%v", val)
		}
	}

	if err := rdb.HSet(ctx, Key(accountKeyPrefix+id), fields).Err(); err != nil {
		return fmt.Errorf("update account %s: %w", id, err)
	}

	// Update available index based on status change.
	if statusVal, ok := updates["status"]; ok {
		status := fmt.Sprintf("%v", statusVal)
		if status == string(model.AccountStatusActive) {
			rdb.SAdd(ctx, Key(accountsAvailKey), id)
		} else {
			rdb.SRem(ctx, Key(accountsAvailKey), id)
		}
	}

	log.Info().Str("id", id).Msg("Account updated")
	return nil
}

// DeleteAccount removes an account and all associated index entries.
func DeleteAccount(ctx context.Context, id string) error {
	rdb := GetClient()

	acct, err := GetAccountByID(ctx, id)
	if err != nil {
		return err
	}
	if acct == nil {
		return fmt.Errorf("account %s not found", id)
	}

	pipe := rdb.Pipeline()
	pipe.Del(ctx, Key(accountKeyPrefix+id))
	pipe.ZRem(ctx, Key(accountsIndexKey), id)
	pipe.SRem(ctx, Key(accountsAvailKey), id)
	pipe.SRem(ctx, Key(machineIDsKey), acct.MachineID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete account %s: %w", id, err)
	}

	log.Info().Str("id", id).Msg("Account deleted")
	return nil
}

