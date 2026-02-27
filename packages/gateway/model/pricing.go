package model

// ModelPriceInfo holds per-token pricing for a single model variant.
type ModelPriceInfo struct {
	InputPrice      float64 `json:"input_cost_per_token"`
	OutputPrice     float64 `json:"output_cost_per_token"`
	CacheWritePrice float64 `json:"cache_creation_input_token_cost,omitempty"`
	CacheReadPrice  float64 `json:"cache_read_input_token_cost,omitempty"`
	MaxInputTokens  int     `json:"max_input_tokens,omitempty"`
	MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
	SupportsCache   bool    `json:"supports_prompt_caching,omitempty"`
}

// CostCalculation is the result of computing request cost from token counts.
type CostCalculation struct {
	InputCost        float64 `json:"inputCost"`
	OutputCost       float64 `json:"outputCost"`
	CacheCreationCost float64 `json:"cacheCreationCost"`
	CacheReadCost    float64 `json:"cacheReadCost"`
	TotalCost        float64 `json:"totalCost"`
}
