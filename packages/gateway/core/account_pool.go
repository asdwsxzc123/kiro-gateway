package core

import (
	"sort"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// AccountPool manages multi-account load balancing with LRU + concurrency-aware selection.
type AccountPool struct {
	mu              sync.RWMutex
	accounts        map[string]*model.ProxyAccount
	concurrency     map[string]int32
	consecutiveErrs map[string]int
	lastUsed        map[string]int64
	poolConfig      PoolConfig
	waitQueue       *AccountWaitQueue
}

type PoolConfig struct {
	ErrorCooldownMs      int
	MaxConsecutiveErrors int
	QuotaResetMs         int
	ErrorCooldown429     int
	ErrorCooldown529     int
	ErrorCooldown5xx     int
	AutoSwitchOnQuota    bool
}

// NewAccountPool creates a new AccountPool with the given configuration.
func NewAccountPool(cfg PoolConfig) *AccountPool {
	return &AccountPool{
		accounts:        make(map[string]*model.ProxyAccount),
		concurrency:     make(map[string]int32),
		consecutiveErrs: make(map[string]int),
		lastUsed:        make(map[string]int64),
		poolConfig:      cfg,
	}
}

// SetWaitQueue attaches an AccountWaitQueue for notification when slots free up.
func (p *AccountPool) SetWaitQueue(wq *AccountWaitQueue) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.waitQueue = wq
}

// AddAccount adds or replaces an account in the pool.
func (p *AccountPool) AddAccount(account *model.ProxyAccount) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accounts[account.ID] = account
	if _, ok := p.concurrency[account.ID]; !ok {
		p.concurrency[account.ID] = 0
	}
	if _, ok := p.consecutiveErrs[account.ID]; !ok {
		p.consecutiveErrs[account.ID] = 0
	}
	if _, ok := p.lastUsed[account.ID]; !ok {
		p.lastUsed[account.ID] = account.LastUsed
	}
}

// RemoveAccount removes an account from the pool by ID.
func (p *AccountPool) RemoveAccount(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.accounts, id)
	delete(p.concurrency, id)
	delete(p.consecutiveErrs, id)
	delete(p.lastUsed, id)
}

// UpdateAccount updates an existing account in the pool.
func (p *AccountPool) UpdateAccount(account *model.ProxyAccount) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accounts[account.ID] = account
}

// GetAccount returns a copy of the account by ID, or nil if not found.
func (p *AccountPool) GetAccount(id string) *model.ProxyAccount {
	p.mu.RLock()
	defer p.mu.RUnlock()
	acct, ok := p.accounts[id]
	if !ok {
		return nil
	}
	copy := *acct
	return &copy
}

// GetAllAccounts returns a snapshot of all accounts in the pool.
func (p *AccountPool) GetAllAccounts() []*model.ProxyAccount {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]*model.ProxyAccount, 0, len(p.accounts))
	for _, acct := range p.accounts {
		copy := *acct
		result = append(result, &copy)
	}
	return result
}

type accountCandidate struct {
	account     *model.ProxyAccount
	concurrency int32
	lastUsed    int64
}

// GetNextAccount selects the best available account using LRU + concurrency-aware scheduling.
// If boundAccountIDs is non-empty, only those accounts are considered.
// Returns the selected account and a skip reason string (empty on success).
func (p *AccountPool) GetNextAccount(boundAccountIDs []string) (*model.ProxyAccount, string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now().UnixMilli()
	boundSet := make(map[string]bool, len(boundAccountIDs))
	for _, id := range boundAccountIDs {
		boundSet[id] = true
	}

	var candidates []accountCandidate
	for id, acct := range p.accounts {
		if len(boundSet) > 0 && !boundSet[id] {
			continue
		}
		if acct.Status != model.AccountStatusActive {
			continue
		}
		if acct.CooldownUntil > 0 && acct.CooldownUntil > now {
			continue
		}
		curr := p.concurrency[id]
		if acct.MaxConcurrency > 0 && int(curr) >= acct.MaxConcurrency {
			continue
		}

		candidates = append(candidates, accountCandidate{
			account:     acct,
			concurrency: curr,
			lastUsed:    p.lastUsed[id],
		})
	}

	if len(candidates) == 0 {
		if len(p.accounts) == 0 {
			return nil, "no accounts configured"
		}
		return nil, "all accounts busy or in cooldown"
	}

	// Sort by: lowest concurrency first, then oldest lastUsed (LRU).
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].concurrency != candidates[j].concurrency {
			return candidates[i].concurrency < candidates[j].concurrency
		}
		return candidates[i].lastUsed < candidates[j].lastUsed
	})

	selected := candidates[0].account
	p.lastUsed[selected.ID] = now

	return selected, ""
}

// IncrementConcurrency increases the active concurrent request count for an account.
func (p *AccountPool) IncrementConcurrency(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.concurrency[id]++
}

// DecrementConcurrency decreases the active concurrent request count for an account.
// If a wait queue is attached, it notifies waiters that a slot has been freed.
func (p *AccountPool) DecrementConcurrency(id string) {
	p.mu.Lock()
	c := p.concurrency[id]
	if c > 0 {
		p.concurrency[id] = c - 1
	}
	wq := p.waitQueue
	p.mu.Unlock()

	if wq != nil {
		wq.NotifySlotFreed(id)
	}
}

// RecordSuccess resets consecutive errors and restores error-suspended accounts.
func (p *AccountPool) RecordSuccess(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.consecutiveErrs[id] = 0
	p.lastUsed[id] = time.Now().UnixMilli()

	acct, ok := p.accounts[id]
	if ok && acct.Status == model.AccountStatusErrorSuspended {
		acct.Status = model.AccountStatusActive
		acct.StatusReason = "recovered after success"
		acct.StatusChangedAt = time.Now().UnixMilli()
		log.Info().Str("accountId", id).Msg("Account recovered from error_suspended")
	}
}

// RecordError increments consecutive error count and applies cooldown based on the error code.
// Returns the cooldown duration in milliseconds applied to the account.
func (p *AccountPool) RecordError(id string, errCode model.KiroErrorCode) int64 {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.consecutiveErrs[id]++
	errCount := p.consecutiveErrs[id]

	acct, ok := p.accounts[id]
	if !ok {
		return 0
	}

	var cooldownMs int64

	switch errCode {
	case model.KiroErrorQuotaExhausted:
		cooldownMs = int64(p.poolConfig.ErrorCooldown429) * 1000
	case model.KiroErrorOverloaded:
		cooldownMs = int64(p.poolConfig.ErrorCooldown529) * 1000
	case model.KiroErrorServerError:
		cooldownMs = int64(p.poolConfig.ErrorCooldown5xx) * 1000
	case model.KiroErrorMonthlyLimit:
		acct.Status = model.AccountStatusSuspended
		acct.StatusReason = "monthly limit reached"
		acct.StatusChangedAt = time.Now().UnixMilli()
		log.Warn().Str("accountId", id).Msg("Account suspended: monthly limit")
		return 0
	case model.KiroErrorAccountSuspended:
		acct.Status = model.AccountStatusSuspended
		acct.StatusReason = "account suspended by provider"
		acct.StatusChangedAt = time.Now().UnixMilli()
		log.Warn().Str("accountId", id).Msg("Account suspended: provider suspension")
		return 0
	case model.KiroErrorAuthError:
		// Auth errors do not apply cooldown; caller should try token refresh.
		return 0
	default:
		cooldownMs = int64(p.poolConfig.ErrorCooldownMs)
	}

	// Check if consecutive errors exceeded threshold.
	if p.poolConfig.MaxConsecutiveErrors > 0 && errCount >= p.poolConfig.MaxConsecutiveErrors {
		acct.Status = model.AccountStatusErrorSuspended
		acct.StatusReason = "max consecutive errors reached"
		acct.StatusChangedAt = time.Now().UnixMilli()
		log.Warn().Str("accountId", id).Int("errors", errCount).Msg("Account error-suspended")
	}

	// Apply cooldown.
	if cooldownMs > 0 {
		acct.CooldownUntil = time.Now().UnixMilli() + cooldownMs
	}

	return cooldownMs
}

// SetStatus explicitly sets an account's status and reason.
func (p *AccountPool) SetStatus(id string, status model.AccountStatus, reason string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	acct, ok := p.accounts[id]
	if !ok {
		return
	}
	acct.Status = status
	acct.StatusReason = reason
	acct.StatusChangedAt = time.Now().UnixMilli()
}

// GetConcurrency returns the current concurrent request count for an account.
func (p *AccountPool) GetConcurrency(id string) int32 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.concurrency[id]
}

// GetConcurrencyStatus returns a snapshot of all account concurrency counts.
func (p *AccountPool) GetConcurrencyStatus() map[string]int32 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make(map[string]int32, len(p.concurrency))
	for id, c := range p.concurrency {
		result[id] = c
	}
	return result
}
