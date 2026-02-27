package core

import (
	"fmt"
	"strings"

	"github.com/kiro-gateway/gateway/model"
)

// typeLabels maps notification types to Chinese labels for display.
var typeLabels = map[model.WebhookNotificationType]string{
	model.WebhookNotifyAccountError:     "账户错误",
	model.WebhookNotifyUsageAlert:       "用量告警",
	model.WebhookNotifyTokenRefreshFail: "令牌刷新失败",
	model.WebhookNotifyHeartbeat:        "心跳",
	model.WebhookNotifyRequestStuck:     "请求卡住",
	model.WebhookNotifyTest:             "测试",
}

// buildTitle returns "Subject · TypeLabel" for display in webhook messages.
func buildTitle(n *model.WebhookNotification) string {
	subject := n.Subject
	if subject == "" {
		subject = "Kiro Gateway"
	}
	label, ok := typeLabels[n.Type]
	if !ok {
		label = string(n.Type)
	}
	return fmt.Sprintf("%s · %s", subject, label)
}

// buildMarkdown returns a rich Markdown body based on the notification type.
func buildMarkdown(n *model.WebhookNotification) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("**时间**: %s\n", n.Timestamp))

	switch n.Type {
	case model.WebhookNotifyAccountError:
		if n.Account != nil {
			name := n.Account.Alias
			if name == "" {
				name = n.Account.Email
			}
			if name == "" {
				name = n.Account.ID
			}
			sb.WriteString(fmt.Sprintf("**账户**: %s\n", name))
		}
		if status, ok := n.Detail["status"]; ok {
			sb.WriteString(fmt.Sprintf("**状态**: %v\n", status))
		}
		if reason, ok := n.Detail["reason"]; ok {
			sb.WriteString(fmt.Sprintf("**原因**: %v\n", reason))
		}
		if msg, ok := n.Detail["message"]; ok {
			sb.WriteString(fmt.Sprintf("**详情**: %v\n", msg))
		}

	case model.WebhookNotifyUsageAlert:
		if n.Account != nil {
			name := n.Account.Alias
			if name == "" {
				name = n.Account.Email
			}
			if name == "" {
				name = n.Account.ID
			}
			sb.WriteString(fmt.Sprintf("**账户**: %s\n", name))
		}
		if cost, ok := n.Detail["currentCost"]; ok {
			sb.WriteString(fmt.Sprintf("**当前用量**: %v\n", cost))
		}
		if threshold, ok := n.Detail["threshold"]; ok {
			sb.WriteString(fmt.Sprintf("**阈值**: %v\n", threshold))
		}

	case model.WebhookNotifyTokenRefreshFail:
		if n.Account != nil {
			name := n.Account.Alias
			if name == "" {
				name = n.Account.Email
			}
			if name == "" {
				name = n.Account.ID
			}
			sb.WriteString(fmt.Sprintf("**账户**: %s\n", name))
		}
		if msg, ok := n.Detail["message"]; ok {
			sb.WriteString(fmt.Sprintf("**错误**: %v\n", msg))
		}

	case model.WebhookNotifyHeartbeat:
		if status, ok := n.Detail["status"]; ok {
			sb.WriteString(fmt.Sprintf("**状态**: %v\n", status))
		}

	case model.WebhookNotifyTest:
		if msg, ok := n.Detail["message"]; ok {
			sb.WriteString(fmt.Sprintf("**消息**: %v\n", msg))
		}

	case model.WebhookNotifyRequestStuck:
		if n.Account != nil {
			name := n.Account.Alias
			if name == "" {
				name = n.Account.ID
			}
			sb.WriteString(fmt.Sprintf("**账户**: %s\n", name))
		}
		for k, v := range n.Detail {
			sb.WriteString(fmt.Sprintf("**%s**: %v\n", k, v))
		}

	default:
		if msg, ok := n.Detail["message"]; ok {
			sb.WriteString(fmt.Sprintf("**详情**: %v\n", msg))
		}
	}

	return strings.TrimRight(sb.String(), "\n")
}

// formatPlainMessage creates a human-readable plain-text notification message.
// Kept as a fallback for any future use.
func formatPlainMessage(n *model.WebhookNotification) string {
	subject := n.Subject
	if subject == "" {
		subject = "Kiro Gateway"
	}

	msg := fmt.Sprintf("[%s] %s\nType: %s\nTime: %s",
		subject, string(n.Type), string(n.Type), n.Timestamp)

	if n.Account != nil {
		alias := n.Account.Alias
		if alias == "" {
			alias = n.Account.ID
		}
		msg += fmt.Sprintf("\nAccount: %s", alias)
	}

	if detail, ok := n.Detail["message"]; ok {
		msg += fmt.Sprintf("\nDetail: %v", detail)
	}

	return msg
}

// colorForType returns a Discord embed color for a notification type.
func colorForType(t model.WebhookNotificationType) int {
	switch t {
	case model.WebhookNotifyAccountError:
		return 0xFF0000
	case model.WebhookNotifyUsageAlert:
		return 0xFFA500
	case model.WebhookNotifyTokenRefreshFail:
		return 0xFF0000
	case model.WebhookNotifyHeartbeat:
		return 0x00FF00
	case model.WebhookNotifyTest:
		return 0x0000FF
	default:
		return 0x808080
	}
}

// buildFeishuPayload creates a Feishu/Lark interactive card payload.
func buildFeishuPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"msg_type": "interactive",
		"card": map[string]interface{}{
			"header": map[string]interface{}{
				"title": map[string]interface{}{
					"tag":     "plain_text",
					"content": title,
				},
			},
			"elements": []interface{}{
				map[string]interface{}{
					"tag": "div",
					"text": map[string]interface{}{
						"tag":     "lark_md",
						"content": markdown,
					},
				},
			},
		},
	}
}

// buildDingTalkPayload creates a DingTalk markdown payload.
func buildDingTalkPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]interface{}{
			"title": title,
			"text":  markdown,
		},
	}
}

// buildSlackPayload creates a Slack blocks payload.
func buildSlackPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"blocks": []interface{}{
			map[string]interface{}{
				"type": "header",
				"text": map[string]interface{}{
					"type": "plain_text",
					"text": title,
				},
			},
			map[string]interface{}{
				"type": "section",
				"text": map[string]interface{}{
					"type": "mrkdwn",
					"text": markdown,
				},
			},
		},
	}
}

// buildWechatWorkPayload creates a WeChat Work (WeCom) markdown payload.
func buildWechatWorkPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]interface{}{
			"content": title + "\n" + markdown,
		},
	}
}

// buildDiscordPayload creates a Discord embeds payload.
func buildDiscordPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"embeds": []interface{}{
			map[string]interface{}{
				"title":       title,
				"description": markdown,
				"color":       colorForType(n.Type),
			},
		},
	}
}

// buildCustomPayload creates a structured JSON payload for custom integrations.
func buildCustomPayload(n *model.WebhookNotification) map[string]interface{} {
	title := buildTitle(n)
	markdown := buildMarkdown(n)
	return map[string]interface{}{
		"type":      string(n.Type),
		"timestamp": n.Timestamp,
		"title":     title,
		"markdown":  markdown,
		"subject":   n.Subject,
		"account":   n.Account,
		"detail":    n.Detail,
	}
}
