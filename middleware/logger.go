package middleware

import (
	"strings"
	"time"

	"starsim/logger"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestID assigns/propagates an X-Request-ID per request.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("x-request-id")
		if id == "" {
			id = uuid.NewString()
		}
		c.Set("requestId", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

// RequestLogger logs each non-trivial HTTP request as structured JSON.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasSuffix(path, "/status") || strings.HasSuffix(path, "/health") || strings.HasSuffix(path, "/favicon.ico") {
			c.Next()
			return
		}
		start := time.Now()
		c.Next()
		dur := time.Since(start).Milliseconds()
		status := c.Writer.Status()
		reqID, _ := c.Get("requestId")
		fields := logger.Fields{
			"requestId": reqID, "method": c.Request.Method, "path": path,
			"status": status, "duration": itoa64(dur) + "ms", "ip": c.ClientIP(),
		}
		switch {
		case status >= 500:
			logger.Error("HTTP Request", fields)
		case status >= 400:
			logger.Warn("HTTP Request", fields)
		default:
			logger.Info("HTTP Request", fields)
		}
	}
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [24]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
