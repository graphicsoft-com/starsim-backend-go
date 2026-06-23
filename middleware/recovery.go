package middleware

import (
	"fmt"
	"net/http"
	"time"

	"starsim/logger"
	"starsim/services"

	"github.com/gin-gonic/gin"
)

// Recovery catches panics, logs them, alerts, and returns a 500 envelope.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				msg := fmt.Sprintf("%v", r)
				reqID, _ := c.Get("requestId")
				logger.Error("Request failed", logger.Fields{
					"requestId": reqID, "method": c.Request.Method,
					"path": c.Request.URL.Path, "statusCode": 500, "error": msg,
				})
				services.AlertServerCrash(msg)
				if !c.Writer.Written() {
					c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
						"error":     "An unexpected error occurred",
						"requestId": reqID,
						"timestamp": time.Now().UTC().Format(time.RFC3339),
					})
				}
			}
		}()
		c.Next()
	}
}

// BlockSensitivePaths returns 404 for probes of sensitive files.
func BlockSensitivePaths() gin.HandlerFunc {
	blocked := []string{".env", ".git", "wp-config.php", "config.php", "phpinfo.php", "aws.config", "aws-config"}
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		for _, b := range blocked {
			if p == "/"+b || p == "/"+b+"/" || hasPrefixSeg(p, "/"+b) {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
		}
		c.Next()
	}
}

func hasPrefixSeg(path, seg string) bool {
	if len(path) < len(seg) {
		return false
	}
	if path[:len(seg)] != seg {
		return false
	}
	return len(path) == len(seg) || path[len(seg)] == '/'
}
