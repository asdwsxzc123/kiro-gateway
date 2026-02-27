package core

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// Sentinel errors for the AccountWaitQueue.
var (
	ErrWaitQueueDisabled = fmt.Errorf("account wait queue disabled")
	ErrQueueFull         = fmt.Errorf("account wait queue full")
	ErrWaitTimeout       = fmt.Errorf("account wait timeout")
)

// AccountWaitConfig holds configuration for the wait queue.
type AccountWaitConfig struct {
	Enabled   bool
	MaxSize   int
	TimeoutMs int
}

// AccountWaitQueue implements FIFO waiting when all accounts are at capacity.
type AccountWaitQueue struct {
	mu     sync.Mutex
	queue  []*waitEntry
	config AccountWaitConfig
	stats  waitStats
}

// waitEntry represents a single waiter in the queue.
type waitEntry struct {
	ch              chan string // receives accountID when slot freed
	boundAccountIDs []string   // optional bound accounts
	createdAt       time.Time
}

// waitStats tracks wait queue statistics.
type waitStats struct {
	TotalWaited   int64
	TotalWoken    int64
	TotalTimedOut int64
	TotalRejected int64
}

// NewAccountWaitQueue creates a new AccountWaitQueue with the given configuration.
func NewAccountWaitQueue(cfg AccountWaitConfig) *AccountWaitQueue {
	return &AccountWaitQueue{
		queue:  make([]*waitEntry, 0),
		config: cfg,
	}
}

// Wait blocks until an account slot becomes available, the context is cancelled,
// or the configured timeout elapses. Returns the freed account ID on success.
func (q *AccountWaitQueue) Wait(ctx context.Context, boundAccountIDs []string) (string, error) {
	if !q.config.Enabled {
		return "", ErrWaitQueueDisabled
	}

	q.mu.Lock()

	// Check if queue is full.
	if q.config.MaxSize > 0 && len(q.queue) >= q.config.MaxSize {
		atomic.AddInt64(&q.stats.TotalRejected, 1)
		q.mu.Unlock()
		return "", ErrQueueFull
	}

	entry := &waitEntry{
		ch:              make(chan string, 1),
		boundAccountIDs: boundAccountIDs,
		createdAt:       time.Now(),
	}
	q.queue = append(q.queue, entry)
	atomic.AddInt64(&q.stats.TotalWaited, 1)
	q.mu.Unlock()

	// Determine timeout duration.
	timeoutMs := q.config.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 5000 // default 5 seconds
	}
	timer := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)
	defer timer.Stop()

	select {
	case accountID := <-entry.ch:
		atomic.AddInt64(&q.stats.TotalWoken, 1)
		return accountID, nil

	case <-ctx.Done():
		q.removeEntry(entry)
		atomic.AddInt64(&q.stats.TotalTimedOut, 1)
		return "", ctx.Err()

	case <-timer.C:
		q.removeEntry(entry)
		atomic.AddInt64(&q.stats.TotalTimedOut, 1)
		return "", ErrWaitTimeout
	}
}

// NotifySlotFreed notifies the first matching waiter that an account slot has been freed.
// It first tries to find a waiter with matching boundAccountIDs, then falls back to FIFO.
func (q *AccountWaitQueue) NotifySlotFreed(freedAccountID string) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.queue) == 0 {
		return
	}

	// First pass: find a waiter bound to this specific account.
	for i, entry := range q.queue {
		if len(entry.boundAccountIDs) > 0 && containsID(entry.boundAccountIDs, freedAccountID) {
			q.queue = append(q.queue[:i], q.queue[i+1:]...)
			entry.ch <- freedAccountID
			return
		}
	}

	// Second pass: pick the first waiter with no bound accounts (FIFO).
	for i, entry := range q.queue {
		if len(entry.boundAccountIDs) == 0 {
			q.queue = append(q.queue[:i], q.queue[i+1:]...)
			entry.ch <- freedAccountID
			return
		}
	}

	// Fallback: pick the very first entry regardless of binding.
	entry := q.queue[0]
	q.queue = q.queue[1:]
	entry.ch <- freedAccountID
}

// GetStatus returns the current wait queue status and statistics.
func (q *AccountWaitQueue) GetStatus() map[string]interface{} {
	q.mu.Lock()
	queueSize := len(q.queue)
	q.mu.Unlock()

	return map[string]interface{}{
		"enabled":      q.config.Enabled,
		"queueSize":    queueSize,
		"maxSize":      q.config.MaxSize,
		"timeoutMs":    q.config.TimeoutMs,
		"totalWaited":  atomic.LoadInt64(&q.stats.TotalWaited),
		"totalWoken":   atomic.LoadInt64(&q.stats.TotalWoken),
		"totalTimedOut": atomic.LoadInt64(&q.stats.TotalTimedOut),
		"totalRejected": atomic.LoadInt64(&q.stats.TotalRejected),
	}
}

// removeEntry removes a specific entry from the queue (used on timeout/cancel).
func (q *AccountWaitQueue) removeEntry(target *waitEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, entry := range q.queue {
		if entry == target {
			q.queue = append(q.queue[:i], q.queue[i+1:]...)
			return
		}
	}
}

// containsID checks if an ID is present in a slice.
func containsID(ids []string, target string) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
