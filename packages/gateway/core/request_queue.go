package core

import (
	"context"
	"sync"
)

// RequestQueue implements a global concurrency limiter using a buffered channel semaphore.
type RequestQueue struct {
	mu      sync.Mutex
	sem     chan struct{}
	maxSize int
	enabled bool
}

// NewRequestQueue creates a new RequestQueue. If maxSize <= 0 or enabled is false,
// the queue is effectively unlimited (no blocking on Acquire).
func NewRequestQueue(maxSize int, enabled bool) *RequestQueue {
	rq := &RequestQueue{
		maxSize: maxSize,
		enabled: enabled,
	}
	if enabled && maxSize > 0 {
		rq.sem = make(chan struct{}, maxSize)
	}
	return rq
}

// Acquire blocks until a slot is available or the context is cancelled.
// Returns nil immediately if the queue is disabled or unlimited.
func (q *RequestQueue) Acquire(ctx context.Context) error {
	if !q.enabled || q.sem == nil {
		return nil
	}

	select {
	case q.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Release frees a slot in the semaphore. Must be called after Acquire returns nil.
func (q *RequestQueue) Release() {
	if !q.enabled || q.sem == nil {
		return
	}
	select {
	case <-q.sem:
	default:
		// No slot to release; this should not happen in normal use.
	}
}

// Size returns the number of currently acquired slots.
func (q *RequestQueue) Size() int {
	if q.sem == nil {
		return 0
	}
	return len(q.sem)
}

// MaxSize returns the maximum number of concurrent slots.
func (q *RequestQueue) MaxSize() int {
	return q.maxSize
}

// IsEnabled returns whether the request queue is active.
func (q *RequestQueue) IsEnabled() bool {
	return q.enabled
}

// UpdateConfig recreates the semaphore with a new size and enabled flag.
// In-flight requests on the old semaphore are not affected.
func (q *RequestQueue) UpdateConfig(maxSize int, enabled bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.maxSize = maxSize
	q.enabled = enabled
	if enabled && maxSize > 0 {
		q.sem = make(chan struct{}, maxSize)
	} else {
		q.sem = nil
	}
}
