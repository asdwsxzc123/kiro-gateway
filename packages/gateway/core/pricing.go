package core

import (
	"strings"

	"github.com/kiro-gateway/gateway/model"
)

// defaultModelID is used when the requested model is not found in the price table.
const defaultModelID = "claude-sonnet-4-5"

// priceTable maps model IDs to per-token pricing info.
var priceTable = map[string]model.ModelPriceInfo{
	// Opus 4.6 family
	"claude-opus-4-6": {
		InputPrice: 0.000015, OutputPrice: 0.000075,
		CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015,
		MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true,
	},
	"claude-opus-4-6-1m": {
		InputPrice: 0.000015, OutputPrice: 0.000075,
		CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015,
		MaxInputTokens: 1000000, MaxOutputTokens: 32000, SupportsCache: true,
	},

	// Opus 4.5
	"claude-opus-4-5": {
		InputPrice: 0.000015, OutputPrice: 0.000075,
		CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015,
		MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true,
	},

	// Opus 4
	"claude-opus-4": {
		InputPrice: 0.000015, OutputPrice: 0.000075,
		CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015,
		MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true,
	},

	// Sonnet 4.6
	"claude-sonnet-4-6": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true,
	},

	// Sonnet 4.5 family
	"claude-sonnet-4-5": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true,
	},
	"claude-sonnet-4-5-20250514": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true,
	},

	// Sonnet 4 family
	"claude-sonnet-4": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true,
	},
	"claude-sonnet-4-20250514": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true,
	},

	// Haiku 4.5 / 3.5
	"claude-haiku-4-5": {
		InputPrice: 0.0000008, OutputPrice: 0.000004,
		CacheWritePrice: 0.000001, CacheReadPrice: 0.00000008,
		MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true,
	},
	"claude-haiku-3-5": {
		InputPrice: 0.0000008, OutputPrice: 0.000004,
		CacheWritePrice: 0.000001, CacheReadPrice: 0.00000008,
		MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true,
	},

	// Legacy 3.5 Sonnet
	"claude-3-5-sonnet": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true,
	},
	"claude-3-5-sonnet-20241022": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true,
	},

	// Legacy Claude 3
	"claude-3-opus": {
		InputPrice: 0.000015, OutputPrice: 0.000075,
		CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015,
		MaxInputTokens: 200000, MaxOutputTokens: 4096, SupportsCache: true,
	},
	"claude-3-sonnet": {
		InputPrice: 0.000003, OutputPrice: 0.000015,
		CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003,
		MaxInputTokens: 200000, MaxOutputTokens: 4096, SupportsCache: true,
	},
	"claude-3-haiku": {
		InputPrice: 0.00000025, OutputPrice: 0.00000125,
		CacheWritePrice: 0.0000003, CacheReadPrice: 0.00000003,
		MaxInputTokens: 200000, MaxOutputTokens: 4096, SupportsCache: true,
	},

	// Aliases (dot notation)
	"claude-opus-4.6":   {InputPrice: 0.000015, OutputPrice: 0.000075, CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015, MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true},
	"claude-opus-4.5":   {InputPrice: 0.000015, OutputPrice: 0.000075, CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015, MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true},
	"claude-sonnet-4.6": {InputPrice: 0.000003, OutputPrice: 0.000015, CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003, MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true},
	"claude-sonnet-4.5": {InputPrice: 0.000003, OutputPrice: 0.000015, CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003, MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true},
	"claude-haiku-4.5":  {InputPrice: 0.0000008, OutputPrice: 0.000004, CacheWritePrice: 0.000001, CacheReadPrice: 0.00000008, MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true},
	"claude-3.5-sonnet": {InputPrice: 0.000003, OutputPrice: 0.000015, CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003, MaxInputTokens: 200000, MaxOutputTokens: 8192, SupportsCache: true},

	// Date-stamped aliases
	"claude-opus-4-6-20260207":  {InputPrice: 0.000015, OutputPrice: 0.000075, CacheWritePrice: 0.00001875, CacheReadPrice: 0.0000015, MaxInputTokens: 200000, MaxOutputTokens: 32000, SupportsCache: true},
	"claude-sonnet-4-20250529":  {InputPrice: 0.000003, OutputPrice: 0.000015, CacheWritePrice: 0.00000375, CacheReadPrice: 0.0000003, MaxInputTokens: 200000, MaxOutputTokens: 64000, SupportsCache: true},
}

// seriesDefaults maps model series names to their default (latest) model IDs.
var seriesDefaults = map[string]string{
	"opus":   "claude-opus-4-6",
	"sonnet": "claude-sonnet-4-6",
	"haiku":  "claude-haiku-4-5",
}

// FindModelPrice resolves a model ID to its pricing info using a 6-level
// matching strategy:
//  1. Exact match
//  2. Normalize dots to dashes (e.g. 4.5 -> 4-5)
//  3. Case-insensitive match
//  4. Series+version smart match
//  5. Series default (latest version)
//  6. Fallback to claude-sonnet-4-5
func FindModelPrice(modelID string) (model.ModelPriceInfo, string) {
	// Level 1: Exact match.
	if info, ok := priceTable[modelID]; ok {
		return info, modelID
	}

	// Level 2: Normalize dots to dashes.
	normalized := strings.ReplaceAll(modelID, ".", "-")
	if normalized != modelID {
		if info, ok := priceTable[normalized]; ok {
			return info, normalized
		}
	}

	// Level 3: Case-insensitive match.
	lower := strings.ToLower(modelID)
	for key, info := range priceTable {
		if strings.ToLower(key) == lower {
			return info, key
		}
	}

	// Level 4: Series+version smart match - extract series name.
	series := extractSeries(lower)
	if series != "" {
		// Try to find a model matching the series with partial version info.
		normalizedLower := strings.ToLower(normalized)
		for key, info := range priceTable {
			if strings.Contains(strings.ToLower(key), series) &&
				strings.HasPrefix(strings.ToLower(key), "claude-"+series) {
				// Check if version components match.
				if fuzzyVersionMatch(normalizedLower, strings.ToLower(key)) {
					return info, key
				}
			}
		}

		// Level 5: Series default (latest version for that series).
		if defaultKey, ok := seriesDefaults[series]; ok {
			if info, ok := priceTable[defaultKey]; ok {
				return info, defaultKey
			}
		}
	}

	// Level 6: Fallback to default model.
	info := priceTable[defaultModelID]
	return info, defaultModelID
}

// extractSeries extracts the model series name (opus, sonnet, haiku) from a
// model identifier string.
func extractSeries(modelID string) string {
	lower := strings.ToLower(modelID)
	for _, series := range []string{"opus", "sonnet", "haiku"} {
		if strings.Contains(lower, series) {
			return series
		}
	}
	return ""
}

// fuzzyVersionMatch checks whether two model IDs share the same series and
// major version component.
func fuzzyVersionMatch(query, candidate string) bool {
	// Extract version-like segments after the series name.
	qParts := strings.Split(query, "-")
	cParts := strings.Split(candidate, "-")

	// Find the version segment (first numeric part after the series name).
	qVer := extractVersionSegments(qParts)
	cVer := extractVersionSegments(cParts)

	if len(qVer) == 0 || len(cVer) == 0 {
		return false
	}

	// Match if at least the first version segment matches.
	return qVer[0] == cVer[0]
}

// extractVersionSegments returns numeric segments found in a split model ID.
func extractVersionSegments(parts []string) []string {
	var versions []string
	foundSeries := false
	for _, p := range parts {
		if p == "opus" || p == "sonnet" || p == "haiku" {
			foundSeries = true
			continue
		}
		if foundSeries && len(p) > 0 && p[0] >= '0' && p[0] <= '9' {
			versions = append(versions, p)
		}
	}
	return versions
}

// CalculateCost computes the total cost for a request given the model and
// token counts. Pricing is per-token (not per-million).
func CalculateCost(modelID string, inputTokens, outputTokens, cacheCreate, cacheRead int) model.CostCalculation {
	price, _ := FindModelPrice(modelID)

	// Uncached input tokens = total input minus cache tokens.
	uncachedInput := inputTokens - cacheCreate - cacheRead
	if uncachedInput < 0 {
		uncachedInput = 0
	}

	inputCost := float64(uncachedInput) * price.InputPrice
	outputCost := float64(outputTokens) * price.OutputPrice
	cacheCreateCost := float64(cacheCreate) * price.CacheWritePrice
	cacheReadCost := float64(cacheRead) * price.CacheReadPrice

	return model.CostCalculation{
		InputCost:         inputCost,
		OutputCost:        outputCost,
		CacheCreationCost: cacheCreateCost,
		CacheReadCost:     cacheReadCost,
		TotalCost:         inputCost + outputCost + cacheCreateCost + cacheReadCost,
	}
}

// GetModelPrices returns pricing information for all known models.
// Since the price table is already per-token, it is returned directly.
func GetModelPrices() map[string]model.ModelPriceInfo {
	result := make(map[string]model.ModelPriceInfo, len(priceTable))
	for id, info := range priceTable {
		result[id] = info
	}
	return result
}

// GetModelPrice returns pricing info for a single model using FindModelPrice.
// Returns nil if the model cannot be resolved (which in practice never happens
// due to the fallback).
func GetModelPrice(modelID string) *model.ModelPriceInfo {
	info, _ := FindModelPrice(modelID)
	return &info
}
