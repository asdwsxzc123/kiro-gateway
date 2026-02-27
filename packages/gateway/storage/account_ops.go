package storage

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// GetAccountCount returns the total number of accounts.
func GetAccountCount(ctx context.Context) (int64, error) {
	return GetClient().ZCard(ctx, Key(accountsIndexKey)).Result()
}

// SetAccountStatus updates an account's status and the available index.
func SetAccountStatus(ctx context.Context, id string, status model.AccountStatus, reason string) error {
	rdb := GetClient()
	now := time.Now().UnixMilli()

	fields := map[string]interface{}{
		"status":          string(status),
		"statusChangedAt": strconv.FormatInt(now, 10),
	}
	if status == model.AccountStatusActive {
		fields["statusReason"] = ""
	} else if reason != "" {
		fields["statusReason"] = reason
	}

	if err := rdb.HSet(ctx, Key(accountKeyPrefix+id), fields).Err(); err != nil {
		return fmt.Errorf("set account status %s: %w", id, err)
	}

	if status == model.AccountStatusActive {
		rdb.SAdd(ctx, Key(accountsAvailKey), id)
	} else {
		rdb.SRem(ctx, Key(accountsAvailKey), id)
	}

	return nil
}

// UpdateAccountUsage increments request or error count and updates lastUsed.
func UpdateAccountUsage(ctx context.Context, id string, success bool, responseTime int64) error {
	rdb := GetClient()
	now := time.Now().UnixMilli()

	pipe := rdb.Pipeline()
	if success {
		pipe.HIncrBy(ctx, Key(accountKeyPrefix+id), "requestCount", 1)
	} else {
		pipe.HIncrBy(ctx, Key(accountKeyPrefix+id), "errorCount", 1)
	}
	pipe.HSet(ctx, Key(accountKeyPrefix+id), "lastUsed", strconv.FormatInt(now, 10))
	pipe.ZAdd(ctx, Key(accountsIndexKey), redis.Z{
		Score:  float64(now),
		Member: id,
	})

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update usage for %s: %w", id, err)
	}
	return nil
}

// SetAccountCooldown sets a cooldown period for an account.
func SetAccountCooldown(ctx context.Context, id string, durationMs int64) error {
	cooldownUntil := time.Now().UnixMilli() + durationMs
	err := GetClient().HSet(ctx, Key(accountKeyPrefix+id),
		"cooldownUntil", strconv.FormatInt(cooldownUntil, 10),
	).Err()
	if err != nil {
		return fmt.Errorf("set cooldown for %s: %w", id, err)
	}
	log.Info().Str("id", id).Int64("durationMs", durationMs).Msg("Account cooldown set")
	return nil
}

// RegenerateMachineID replaces an account's machine ID and updates indexes.
func RegenerateMachineID(ctx context.Context, id string, newMachineID string) error {
	rdb := GetClient()

	acct, err := GetAccountByID(ctx, id)
	if err != nil {
		return err
	}
	if acct == nil {
		return fmt.Errorf("account %s not found", id)
	}

	now := time.Now().UnixMilli()
	oldMID := acct.MachineID

	pipe := rdb.Pipeline()
	pipe.SRem(ctx, Key(machineIDsKey), oldMID)
	pipe.SAdd(ctx, Key(machineIDsKey), newMachineID)
	pipe.HSet(ctx, Key(accountKeyPrefix+id),
		"machineId", newMachineID,
		"machineIdCreatedAt", strconv.FormatInt(now, 10),
	)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("regenerate machine id for %s: %w", id, err)
	}

	log.Info().Str("id", id).Str("old", oldMID).Str("new", newMachineID).Msg("Machine ID regenerated")
	return nil
}

// GetAvailableAccounts returns active accounts not currently in cooldown.
func GetAvailableAccounts(ctx context.Context) ([]model.ProxyAccount, error) {
	rdb := GetClient()
	ids, err := rdb.SMembers(ctx, Key(accountsAvailKey)).Result()
	if err != nil {
		return nil, fmt.Errorf("get available ids: %w", err)
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
		return nil, fmt.Errorf("pipeline get available accounts: %w", err)
	}

	now := time.Now().UnixMilli()
	accounts := make([]model.ProxyAccount, 0, len(ids))
	for _, cmd := range cmds {
		data, err := cmd.Result()
		if err != nil || len(data) == 0 {
			continue
		}
		acct := deserializeAccount(data)
		if acct.Status == model.AccountStatusPaused ||
			acct.Status == model.AccountStatusErrorSuspended ||
			acct.Status == model.AccountStatusSuspended {
			continue
		}
		if acct.CooldownUntil > 0 && acct.CooldownUntil > now {
			continue
		}
		accounts = append(accounts, acct)
	}
	return accounts, nil
}
