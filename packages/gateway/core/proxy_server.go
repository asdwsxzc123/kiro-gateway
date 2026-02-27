package core

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

// ProxyServer is the main proxy orchestration engine.
type ProxyServer struct {
	mu           sync.RWMutex
	pool         *AccountPool
	requestQueue *RequestQueue
	waitQueue    *AccountWaitQueue
	config       proxyConfig
	inflightReqs sync.Map // requestID -> inflightInfo
}

type proxyConfig struct {
	MaxRetries     int
	RetryDelayMs   int
	RequestTimeout int
	AutoContinue   int
	AutoSwitch     bool
	DisableTools   bool
}

type inflightInfo struct {
	AccountID string
	Model     string
	StartTime time.Time
}

// NewProxyServer creates and initializes a ProxyServer, loading accounts from storage.
func NewProxyServer() *ProxyServer {
	cfg := config.GetConfig()
	poolCfg := PoolConfig{
		ErrorCooldownMs:      cfg.AccountPool.CooldownMs,
		MaxConsecutiveErrors: cfg.AccountPool.MaxErrorCount,
		QuotaResetMs:         cfg.AccountPool.QuotaResetMs,
		ErrorCooldown429:     cfg.AccountPool.ErrorCooldown429,
		ErrorCooldown529:     cfg.AccountPool.ErrorCooldown529,
		ErrorCooldown5xx:     cfg.AccountPool.ErrorCooldown5xx,
		AutoSwitchOnQuota:    cfg.Proxy.AutoSwitchOnQuotaExhausted,
	}
	pool := NewAccountPool(poolCfg)
	rq := NewRequestQueue(cfg.Proxy.MaxConcurrent, cfg.Queue.Enabled)
	wq := NewAccountWaitQueue(AccountWaitConfig{
		Enabled:   cfg.AccountWait.Enabled,
		MaxSize:   cfg.AccountWait.MaxSize,
		TimeoutMs: cfg.AccountWait.TimeoutMs,
	})
	pool.SetWaitQueue(wq)

	s := &ProxyServer{
		pool: pool, requestQueue: rq, waitQueue: wq,
		config: proxyConfig{
			MaxRetries:     cfg.Proxy.MaxRetries,
			RetryDelayMs:   cfg.Proxy.RetryDelayMs,
			RequestTimeout: cfg.Proxy.RequestTimeout,
			AutoContinue:   cfg.Proxy.AutoContinueRounds,
			AutoSwitch:     cfg.Proxy.AutoSwitchOnQuotaExhausted,
			DisableTools:   cfg.Proxy.DisableTools,
		},
	}
	_ = s.loadAccountsFromStorage()
	return s
}

func (s *ProxyServer) loadAccountsFromStorage() error {
	ctx := context.Background()
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to load accounts from storage")
		return err
	}
	for i := range accounts {
		s.pool.AddAccount(&accounts[i])
	}
	log.Info().Int("count", len(accounts)).Msg("Loaded accounts into pool")
	return nil
}

// HandleClaudeRequest handles a non-streaming Claude request with retry logic.
func (s *ProxyServer) HandleClaudeRequest(
	c *gin.Context, request *model.ClaudeRequest,
	apiKeyID string, boundAccountIDs []string,
) (interface{}, error) {
	ctx := c.Request.Context()
	if err := s.requestQueue.Acquire(ctx); err != nil {
		return nil, fmt.Errorf("request queue acquire: %w", err)
	}
	defer s.requestQueue.Release()
	return s.callWithRetry(ctx, request, apiKeyID, boundAccountIDs)
}

// selectAccount picks the next available account, optionally waiting if all are busy.
func (s *ProxyServer) selectAccount(boundAccountIDs []string) (*model.ProxyAccount, error) {
	acct, reason := s.pool.GetNextAccount(boundAccountIDs)
	if acct != nil {
		return acct, nil
	}
	// Try waiting for a slot if the wait queue is enabled.
	if s.waitQueue != nil && s.waitQueue.config.Enabled {
		ctx, cancel := context.WithTimeout(context.Background(),
			time.Duration(s.waitQueue.config.TimeoutMs)*time.Millisecond)
		defer cancel()
		accountID, err := s.waitQueue.Wait(ctx, boundAccountIDs)
		if err == nil && accountID != "" {
			if a := s.pool.GetAccount(accountID); a != nil {
				return a, nil
			}
		}
	}
	return nil, &model.KiroApiError{
		StatusCode: 529, ErrorCode: model.KiroErrorOverloaded,
		Msg: fmt.Sprintf("no available account: %s", reason), Retryable: true,
	}
}

// callWithRetry executes the request with automatic retries on transient errors.
func (s *ProxyServer) callWithRetry(
	ctx context.Context, request *model.ClaudeRequest,
	apiKeyID string, boundAccountIDs []string,
) (*model.ClaudeResponse, error) {
	s.mu.RLock()
	maxRetries := s.config.MaxRetries
	retryDelayMs := s.config.RetryDelayMs
	s.mu.RUnlock()

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		acct, err := s.selectAccount(boundAccountIDs)
		if err != nil {
			lastErr = err
			break
		}
		s.pool.IncrementConcurrency(acct.ID)
		requestID := fmt.Sprintf("%s-%d", acct.ID, time.Now().UnixNano())
		s.inflightReqs.Store(requestID, inflightInfo{
			AccountID: acct.ID, Model: request.Model, StartTime: time.Now(),
		})

		resp, callErr := s.executeRequest(ctx, request, acct)
		s.inflightReqs.Delete(requestID)
		s.pool.DecrementConcurrency(acct.ID)

		if callErr == nil {
			s.pool.RecordSuccess(acct.ID)
			return resp, nil
		}
		lastErr = callErr

		kiroErr, ok := callErr.(*model.KiroApiError)
		if !ok {
			break
		}
		action := ClassifyRetryError(kiroErr)
		s.pool.RecordError(acct.ID, kiroErr.ErrorCode)
		_ = apiKeyID

		if action == RetryActionNone {
			return nil, lastErr
		}
		if attempt < maxRetries {
			select {
			case <-time.After(AddJitter(retryDelayMs)):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
	}
	return nil, lastErr
}

// executeRequest is a placeholder for the actual Kiro API call.
func (s *ProxyServer) executeRequest(
	ctx context.Context, request *model.ClaudeRequest, account *model.ProxyAccount,
) (*model.ClaudeResponse, error) {
	_ = ctx
	_ = request
	_ = account
	return nil, fmt.Errorf("executeRequest not implemented")
}

// RefreshAccounts reloads all accounts from storage into the pool.
func (s *ProxyServer) RefreshAccounts() error {
	return s.loadAccountsFromStorage()
}

// UpdateConfig applies gateway configuration changes. If no config is passed,
// it reloads from storage.
func (s *ProxyServer) UpdateConfig(cfgs ...*model.GatewayConfig) error {
	var cfg *model.GatewayConfig
	if len(cfgs) > 0 && cfgs[0] != nil {
		cfg = cfgs[0]
	} else {
		ctx := context.Background()
		var err error
		cfg, err = storage.GetGatewayConfig(ctx)
		if err != nil {
			return fmt.Errorf("load gateway config: %w", err)
		}
	}
	s.applyGatewayConfig(cfg)
	return nil
}

func (s *ProxyServer) applyGatewayConfig(cfg *model.GatewayConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg.MaxRetries > 0 {
		s.config.MaxRetries = cfg.MaxRetries
	}
	if cfg.RetryDelay > 0 {
		s.config.RetryDelayMs = cfg.RetryDelay
	}
	if cfg.RequestTimeout > 0 {
		s.config.RequestTimeout = cfg.RequestTimeout
	}
	if cfg.AutoContinueRounds != nil {
		s.config.AutoContinue = *cfg.AutoContinueRounds
	}
	if cfg.AutoSwitchOnQuotaExhausted != nil {
		s.config.AutoSwitch = *cfg.AutoSwitchOnQuotaExhausted
	}
	if cfg.DisableTools != nil {
		s.config.DisableTools = *cfg.DisableTools
	}
	if cfg.QueueEnabled != nil || cfg.QueueMaxSize != nil {
		enabled := s.requestQueue.IsEnabled()
		maxSize := s.requestQueue.MaxSize()
		if cfg.QueueEnabled != nil {
			enabled = *cfg.QueueEnabled
		}
		if cfg.QueueMaxSize != nil {
			maxSize = *cfg.QueueMaxSize
		}
		s.requestQueue.UpdateConfig(maxSize, enabled)
	}
}

// GetPool returns the underlying AccountPool.
func (s *ProxyServer) GetPool() *AccountPool { return s.pool }

// GetRequestQueue returns the underlying RequestQueue.
func (s *ProxyServer) GetRequestQueue() *RequestQueue { return s.requestQueue }

// GetWaitQueue returns the underlying AccountWaitQueue.
func (s *ProxyServer) GetWaitQueue() *AccountWaitQueue { return s.waitQueue }

// GetConcurrencyStatus returns a summary of current concurrency state.
func (s *ProxyServer) GetConcurrencyStatus() map[string]interface{} {
	concurrency := s.pool.GetConcurrencyStatus()
	var total int32
	for _, c := range concurrency {
		total += c
	}
	return map[string]interface{}{
		"accounts": concurrency, "total": total,
		"queueSize": s.requestQueue.Size(), "queueMax": s.requestQueue.MaxSize(),
		"queueEnabled": s.requestQueue.IsEnabled(),
	}
}

// GetInflightRequests returns a snapshot of all in-flight requests.
func (s *ProxyServer) GetInflightRequests() []inflightInfo {
	var result []inflightInfo
	s.inflightReqs.Range(func(_, value interface{}) bool {
		if info, ok := value.(inflightInfo); ok {
			result = append(result, info)
		}
		return true
	})
	return result
}
