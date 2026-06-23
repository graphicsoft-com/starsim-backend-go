package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"starsim/config"
	"starsim/logger"
)

const llmModel = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo"

// agentMessage is one OpenAI-style chat message.
type agentMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string         `json:"model"`
	Messages    []agentMessage `json:"messages"`
	MaxTokens   int            `json:"max_tokens"`
	Temperature float64        `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

var llmHTTP = &http.Client{Timeout: 90 * time.Second}

// getAgentResponse calls DeepInfra's OpenAI-compatible chat completions API.
// Retries connection errors with linear backoff (2s, 4s, 6s) up to `retries`.
func getAgentResponse(ctx context.Context, systemPrompt string, history []agentMessage, retries int) (string, error) {
	trimmed := history
	if len(trimmed) > maxHistoryLength {
		trimmed = trimmed[len(trimmed)-maxHistoryLength:]
	}
	msgs := make([]agentMessage, 0, len(trimmed)+1)
	msgs = append(msgs, agentMessage{Role: "system", Content: systemPrompt})
	msgs = append(msgs, trimmed...)

	body, _ := json.Marshal(chatRequest{
		Model:       llmModel,
		Messages:    msgs,
		MaxTokens:   150,
		Temperature: 0.8,
	})

	url := strings.TrimRight(config.C.OpenAIBaseURL, "/") + "/chat/completions"

	var lastErr error
	for attempt := 1; attempt <= retries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+config.C.DeepInfraAPIKey)

		resp, err := llmHTTP.Do(req)
		if err != nil {
			lastErr = err
			if isConnectionError(err) && attempt < retries {
				wait := time.Duration(attempt*2000) * time.Millisecond
				logger.LLMLog("warn", fmt.Sprintf("DNS error — retrying in %.0fs (attempt %d/%d) — root cause: %v", wait.Seconds(), attempt, retries, err), nil)
				select {
				case <-time.After(wait):
				case <-ctx.Done():
					return "", ctx.Err()
				}
				continue
			}
			return "", err
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("LLM HTTP %d: %s", resp.StatusCode, string(data))
			// non-connection error → no retry, matches Node behavior (only conn retries)
			return "", lastErr
		}
		var cr chatResponse
		if err := json.Unmarshal(data, &cr); err != nil {
			return "", err
		}
		if len(cr.Choices) == 0 {
			return "[no response]", nil
		}
		return strings.TrimSpace(cr.Choices[0].Message.Content), nil
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("Max retries reached")
}

func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, code := range []string{"EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET",
		"no such host", "connection refused", "connection reset", "timeout", "Connection error", "dial tcp"} {
		if strings.Contains(msg, code) {
			return true
		}
	}
	return false
}

// flipHistory swaps each message's role so the patient agent sees the history
// from its own first-person perspective.
func flipHistory(history []agentMessage) []agentMessage {
	out := make([]agentMessage, len(history))
	for i, m := range history {
		role := m.Role
		if role == "assistant" {
			role = "user"
		} else if role == "user" {
			role = "assistant"
		}
		out[i] = agentMessage{Role: role, Content: m.Content}
	}
	return out
}
