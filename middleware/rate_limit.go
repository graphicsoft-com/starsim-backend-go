package middleware

import (
	"net/http"
	"sync"
	"time"

	"starsim/config"
	"starsim/logger"

	"github.com/gin-gonic/gin"
)

var exemptIPs = map[string]bool{"::1": true, "127.0.0.1": true, "::ffff:127.0.0.1": true}

type rateLimiter struct {
	windowMs int
	limit    int
	message  string
	mu       sync.Mutex
	hits     map[string][]int64
}

// NewRateLimiter builds a sliding-window per-IP limiter.
func NewRateLimiter(windowMs, limit int, message string) gin.HandlerFunc {
	rl := &rateLimiter{windowMs: windowMs, limit: limit, message: message, hits: map[string][]int64{}}
	go rl.sweep()
	return rl.handle
}

func (rl *rateLimiter) sweep() {
	for {
		time.Sleep(60 * time.Second)
		now := time.Now().UnixMilli()
		rl.mu.Lock()
		for ip, times := range rl.hits {
			var keep []int64
			for _, t := range times {
				if now-t < int64(rl.windowMs) {
					keep = append(keep, t)
				}
			}
			if len(keep) == 0 {
				delete(rl.hits, ip)
			} else {
				rl.hits[ip] = keep
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *rateLimiter) handle(c *gin.Context) {
	if config.C.DisableRateLimit {
		c.Next()
		return
	}
	ip := c.ClientIP()
	if exemptIPs[ip] {
		c.Next()
		return
	}
	now := time.Now().UnixMilli()
	rl.mu.Lock()
	times := rl.hits[ip]
	var keep []int64
	for _, t := range times {
		if now-t < int64(rl.windowMs) {
			keep = append(keep, t)
		}
	}
	count := len(keep)
	if count >= rl.limit {
		rl.hits[ip] = keep
		rl.mu.Unlock()
		reqID, _ := c.Get("requestId")
		logger.Warn("Rate limit exceeded", logger.Fields{
			"event": "rate_limit_exceeded", "ip": ip, "requestId": reqID,
			"path": c.Request.URL.Path, "count": count, "limit": rl.limit,
		})
		c.Header("Retry-After", itoa64(int64(rl.windowMs/1000)))
		c.Header("X-RateLimit-Limit", itoa64(int64(rl.limit)))
		c.Header("X-RateLimit-Remaining", "0")
		c.Header("X-RateLimit-Reset", itoa64((now+int64(rl.windowMs))/1000))
		msg := rl.message
		if msg == "" {
			msg = "Too many requests, please try again later."
		}
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"message": msg})
		return
	}
	keep = append(keep, now)
	rl.hits[ip] = keep
	remaining := rl.limit - len(keep)
	rl.mu.Unlock()
	c.Header("X-RateLimit-Limit", itoa64(int64(rl.limit)))
	c.Header("X-RateLimit-Remaining", itoa64(int64(remaining)))
	c.Next()
}
