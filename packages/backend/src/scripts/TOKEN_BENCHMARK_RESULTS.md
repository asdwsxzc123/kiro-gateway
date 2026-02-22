# Token Estimation Benchmark Results

## v2 — Final (2026-02-21)

- **Model**: claude-sonnet-4-20250514
- **Encoder**: cl100k_base (js-tiktoken)
- **Method**: `countAllTokens()` (gateway actual path) vs Anthropic `count_tokens` API
- **Corrections**: CJK ratio + code density + length-aware + separated overhead

### Results

| Category | Label | Actual | Raw | GW | Raw% | GW% |
|----------|-------|-------:|----:|---:|-----:|----:|
| English | Short sentence | 29 | 8 | 31 | -72.4% | **+6.9%** |
| English | Medium paragraph | 100 | 75 | 113 | -25.0% | +13.0% |
| English | Technical doc | 181 | 152 | 208 | -16.0% | +14.9% |
| Chinese | Short sentence | 34 | 13 | 34 | -61.8% | **+0.0%** |
| Chinese | Medium paragraph | 201 | 190 | 220 | -5.5% | +9.5% |
| Chinese | Technical doc | 238 | 174 | 217 | -26.9% | -8.8% |
| Code | TypeScript function | 323 | 243 | 342 | -24.8% | **+5.9%** |
| Code | Python class | 269 | 214 | 284 | -20.4% | **+5.6%** |
| JSON | API request payload | 449 | 348 | 480 | -22.5% | **+6.9%** |
| JSON | Config object | 152 | 111 | 167 | -27.0% | +9.9% |
| Mixed | CN-EN tech discussion | 225 | 186 | 250 | -17.3% | +11.1% |
| Mixed | System prompt | 119 | 89 | 130 | -25.2% | +9.2% |
| Long | Repeated EN (1k+ tok) | 2320 | 2050 | 2542 | -11.6% | +9.6% |
| Long | Long Chinese (1k+ tok) | 3351 | 3630 | 3360 | +8.3% | **+0.3%** |

### Category Summary

| Category | Avg Raw% | Avg GW% | Max |GW%| |
|----------|---------|--------|-----------|
| Chinese | -31.4% | **+0.2%** | 9.5% |
| Code | -22.6% | **+5.7%** | 5.9% |
| Long | -1.7% | **+4.9%** | 9.6% |
| JSON | -24.7% | +8.4% | 9.9% |
| Mixed | -21.3% | +10.2% | 11.1% |
| English | -37.8% | +11.6% | 14.9% |

### Overall

| Metric | Raw (baseline) | Gateway (v2) |
|--------|---------------|-------------|
| Avg absolute error | 26.1% | **8.0%** |
| Max absolute error | 72.4% | **14.9%** |
| Avg signed error | -24.9% | +6.7% |
| **Improvement** | — | **69.4%** |

### Bias Direction

Gateway v2 systematically **over-estimates** by +6.7% on average. This is intentional — for a proxy gateway, over-estimation is preferable to under-estimation (conservative billing).

---

## Optimization History

### v0 — Original (single factor)
- `cl100k_base * 1.15` global factor
- No message overhead calibration
- Avg absolute error: **19.0%** (estimated, with old benchmark methodology)
- Max error: **69.0%** (Chinese long text at +24.6%)

### v1 — CJK-aware adaptive (round 1)
- CJK ratio detection with interpolation `0.95 ~ 1.25`
- Benchmark: raw text only (no message overhead)
- Avg absolute error: **15.2%**
- Improvement: 20.1% reduction from v0

### v2 — Final (current)
Comprehensive 4-layer optimization:
1. **Message overhead calibration**: `MESSAGE_OVERHEAD(10) + REQUEST_OVERHEAD(10)` per message (was 4+3=7)
2. **Content-aware correction**: 3-tier detection (CJK ratio → code density → ASCII fallback)
3. **Length-aware CJK**: `FACTOR_CJK_MEDIUM(1.05)` vs `FACTOR_CJK_LONG(0.92)` at 500 raw token threshold
4. **Overhead isolation**: Correction factor applied to content tokens only, not to fixed overhead

| Correction Factor | Value | Applies To |
|-------------------|-------|-----------|
| FACTOR_NON_CJK | 1.23 | English prose, Markdown |
| FACTOR_CODE | 1.32 | Code, JSON, structured data |
| FACTOR_CJK_MEDIUM | 1.05 | CJK text < 500 raw tokens |
| FACTOR_CJK_LONG | 0.92 | CJK text >= 500 raw tokens |

---

## Design Decisions

### Why over-estimate is acceptable
- Token counts are used for stats display, cost estimation, and rate limiting
- Over-estimation = conservative billing (safe)
- Under-estimation = user charged less than actual (revenue loss)

### Why not use API-returned tokens
- The gateway proxies to Kiro/AWS endpoints, not Anthropic directly
- Kiro API's `messageMetadataEvent` token counts are unreliable
- Self-calculation ensures consistency across all code paths

### Remaining improvement opportunities
- **English prose**: FACTOR_NON_CJK 1.23 causes +11-15% for English. Lowering to ~1.18 would help English but hurt code/JSON
- **Multi-message overhead**: Current benchmarks only test single messages. Multi-turn conversations may have different per-message overhead
- **System prompt overhead**: Not tested separately. System prompts may have additional structural overhead
