package core

// CacheRatio tracks prompt caching efficiency for a single request.
// It records how many tokens were read from cache, created in cache,
// and sent as uncached input, along with the computed hit rate.
type CacheRatio struct {
	CacheReadTokens   int     `json:"cacheReadTokens"`
	CacheCreateTokens int     `json:"cacheCreateTokens"`
	InputTokens       int     `json:"inputTokens"`
	HitRate           float64 `json:"hitRate"`
}

// CalculateCacheRatio computes the cache efficiency from token counts.
// The hit rate is defined as the proportion of cache-read tokens out of
// the total tokens processed (input + cache read + cache create).
// Returns a zero-value CacheRatio if the total token count is zero.
func CalculateCacheRatio(inputTokens, cacheRead, cacheCreate int) CacheRatio {
	total := inputTokens + cacheRead + cacheCreate

	var hitRate float64
	if total > 0 {
		hitRate = float64(cacheRead) / float64(total)
	}

	return CacheRatio{
		CacheReadTokens:   cacheRead,
		CacheCreateTokens: cacheCreate,
		InputTokens:       inputTokens,
		HitRate:           hitRate,
	}
}
